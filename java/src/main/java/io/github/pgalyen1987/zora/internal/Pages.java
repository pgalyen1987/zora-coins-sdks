package io.github.pgalyen1987.zora.internal;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Set;
import java.util.function.BiConsumer;
import java.util.function.Function;

/**
 * Walks paginated results lazily: the next page is fetched only when the caller reaches it. Stops after
 * the last page, or if the API hands back a cursor it already gave. Internal.
 */
public final class Pages<P, T> implements Iterator<T> {
    /** One page: its items and the next cursor (null on the last page). */
    public static final class Page<T> {
        final List<T> items;
        final String next;

        /** A page. */
        public Page(List<T> items, String next) {
            this.items = items;
            this.next = next;
        }
    }

    private final P params;
    private final Function<P, Page<T>> fetch;
    private final BiConsumer<P, String> setAfter;
    private final Deque<T> buffer = new ArrayDeque<>();
    private final Set<String> seen = new HashSet<>();
    private boolean done;

    /** Pages starting from {@code params}. */
    public Pages(P params, Function<P, Page<T>> fetch, BiConsumer<P, String> setAfter) {
        this.params = params;
        this.fetch = fetch;
        this.setAfter = setAfter;
    }

    @Override
    public boolean hasNext() {
        while (buffer.isEmpty() && !done) {
            Page<T> page = fetch.apply(params);
            buffer.addAll(page.items);
            if (page.next == null || page.next.isEmpty() || !seen.add(page.next)) done = true;
            else setAfter.accept(params, page.next);
        }
        return !buffer.isEmpty();
    }

    @Override
    public T next() {
        if (!hasNext()) throw new NoSuchElementException();
        return buffer.pollFirst();
    }
}
