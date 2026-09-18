package zora

import (
	"bytes"
	"fmt"
	"strconv"
)

// FlexBool is a boolean the API sometimes sends as a string: /quote returns "success": "true"
// although its spec says boolean. It decodes true, false, "true" and "false".
type FlexBool bool

// UnmarshalJSON accepts a JSON boolean or a string holding one.
func (b *FlexBool) UnmarshalJSON(data []byte) error {
	s := string(bytes.Trim(data, `"`))
	v, err := strconv.ParseBool(s)
	if err != nil {
		return fmt.Errorf("zora: %s is not a boolean", data)
	}
	*b = FlexBool(v)
	return nil
}
