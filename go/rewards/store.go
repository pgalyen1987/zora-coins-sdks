package rewards

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
)

// Store keeps indexed events and which block ranges have been scanned for which address, so a
// second scan only fetches new blocks. MemoryStore and FileStore are provided; implement Store to
// keep events in your own database.
type Store interface {
	// Save stores events and records that [from, to] was scanned for addresses at this version.
	Save(events []*Event, addresses []string, version int, from, to uint64) error
	// Scanned returns the merged block ranges already scanned for address at version.
	Scanned(address string, version int) ([][2]uint64, error)
	// EventsFor returns stored events paying any of addresses, from sinceBlock, oldest first.
	EventsFor(addresses []string, sinceBlock uint64) ([]*Event, error)
}

// MemoryStore keeps everything in memory. Safe for concurrent use.
type MemoryStore struct {
	mu     sync.Mutex
	events map[string]*Event // txHash:logIndex -> event
	scans  map[string][][2]uint64
}

// NewMemoryStore returns an empty in-memory store.
func NewMemoryStore() *MemoryStore {
	return &MemoryStore{events: map[string]*Event{}, scans: map[string][][2]uint64{}}
}

func scanKey(address string, version int) string {
	return strings.ToLower(address) + "@v" + strconv.Itoa(version)
}

func eventKey(e *Event) string { return e.TxHash + ":" + strconv.FormatUint(e.LogIndex, 10) }

// Save implements Store.
func (m *MemoryStore) Save(events []*Event, addresses []string, version int, from, to uint64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, e := range events {
		m.events[eventKey(e)] = e
	}
	for _, a := range addresses {
		k := scanKey(a, version)
		m.scans[k] = mergeRanges(append(m.scans[k], [2]uint64{from, to}))
	}
	return nil
}

// Scanned implements Store.
func (m *MemoryStore) Scanned(address string, version int) ([][2]uint64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([][2]uint64(nil), m.scans[scanKey(address, version)]...), nil
}

// EventsFor implements Store.
func (m *MemoryStore) EventsFor(addresses []string, sinceBlock uint64) ([]*Event, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	watch := lowerSet(addresses)
	var out []*Event
	for _, e := range m.events {
		if e.Block >= sinceBlock && e.Pays(watch) {
			out = append(out, e)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Block != out[j].Block {
			return out[i].Block < out[j].Block
		}
		return out[i].LogIndex < out[j].LogIndex
	})
	return out, nil
}

// FileStore is a MemoryStore persisted to one JSON file after every save, so scans resume across
// runs with no database. Fine for thousands of events; use your own Store beyond that.
type FileStore struct {
	*MemoryStore
	path string
}

type fileSnapshot struct {
	Events []*Event               `json:"events"`
	Scans  map[string][][2]uint64 `json:"scans"`
}

// OpenFileStore loads path if it exists, or starts empty.
func OpenFileStore(path string) (*FileStore, error) {
	st := &FileStore{MemoryStore: NewMemoryStore(), path: path}
	b, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return st, nil
	}
	if err != nil {
		return nil, err
	}
	var snap fileSnapshot
	if err := json.Unmarshal(b, &snap); err != nil {
		return nil, err
	}
	for _, e := range snap.Events {
		st.events[eventKey(e)] = e
	}
	for k, v := range snap.Scans {
		st.scans[k] = v
	}
	return st, nil
}

// Save implements Store and writes the file atomically.
func (f *FileStore) Save(events []*Event, addresses []string, version int, from, to uint64) error {
	if err := f.MemoryStore.Save(events, addresses, version, from, to); err != nil {
		return err
	}
	f.mu.Lock()
	snap := fileSnapshot{Scans: f.scans}
	for _, e := range f.events {
		snap.Events = append(snap.Events, e)
	}
	b, err := json.Marshal(snap)
	f.mu.Unlock()
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(f.path), ".zora-rewards-*")
	if err != nil {
		return err
	}
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return err
	}
	tmp.Close()
	return os.Rename(tmp.Name(), f.path)
}

func lowerSet(addresses []string) map[string]bool {
	out := make(map[string]bool, len(addresses))
	for _, a := range addresses {
		out[strings.ToLower(a)] = true
	}
	return out
}

func mergeRanges(r [][2]uint64) [][2]uint64 {
	sort.Slice(r, func(i, j int) bool { return r[i][0] < r[j][0] })
	var out [][2]uint64
	for _, x := range r {
		if n := len(out); n > 0 && x[0] <= out[n-1][1]+1 {
			out[n-1][1] = max(out[n-1][1], x[1])
		} else {
			out = append(out, x)
		}
	}
	return out
}

// missing returns the parts of [lo, hi] not covered by have.
func missing(lo, hi uint64, have [][2]uint64) [][2]uint64 {
	var gaps [][2]uint64
	cur := lo
	for _, h := range mergeRanges(append([][2]uint64(nil), have...)) {
		if h[1] < cur || h[0] > hi {
			continue
		}
		if h[0] > cur {
			gaps = append(gaps, [2]uint64{cur, h[0] - 1})
		}
		cur = max(cur, h[1]+1)
	}
	if cur <= hi {
		gaps = append(gaps, [2]uint64{cur, hi})
	}
	return gaps
}
