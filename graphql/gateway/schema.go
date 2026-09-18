// Package gateway serves the Zora Coins API as one GraphQL schema.
//
// The schema is generated from Zora's OpenAPI spec by the same code that generates the SDKs
// (codegen/emit_graphql.py), and every root field calls the Go SDK. The gateway stores nothing: it
// forwards each caller's own Zora API key and answers from Zora's API or from Base directly.
package gateway

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/graphql-go/graphql"
)

//go:embed schema_gen.json
var schemaJSON []byte

type fieldDef struct {
	Name  string   `json:"name"`
	JSON  string   `json:"json"`
	Type  string   `json:"type"`
	Doc   string   `json:"doc"`
	Param string   `json:"param"`
	Args  []argDef `json:"args"`
	Op    string   `json:"op"`
}

type argDef struct {
	Name string `json:"name"`
	Type string `json:"type"`
	Doc  string `json:"doc"`
}

type schemaData struct {
	Enums []struct {
		Name   string   `json:"name"`
		Values []string `json:"values"`
		Doc    string   `json:"doc"`
	} `json:"enums"`
	Objects []struct {
		Name   string     `json:"name"`
		Doc    string     `json:"doc"`
		Fields []fieldDef `json:"fields"`
	} `json:"objects"`
	Inputs []struct {
		Name   string     `json:"name"`
		Doc    string     `json:"doc"`
		Fields []fieldDef `json:"fields"`
	} `json:"inputs"`
	Query    []fieldDef `json:"query"`
	Mutation []fieldDef `json:"mutation"`
}

// NewSchema builds the executable schema. resolve is called for every root field with the field's
// name and its arguments; nested fields read straight from the JSON the root returned.
func NewSchema(resolve func(p graphql.ResolveParams, field string) (any, error)) (graphql.Schema, error) {
	var d schemaData
	if err := json.Unmarshal(schemaJSON, &d); err != nil {
		return graphql.Schema{}, err
	}
	outputs := map[string]graphql.Output{}
	inputs := map[string]graphql.Input{}
	for _, s := range []*graphql.Scalar{graphql.String, graphql.Int, graphql.Float, graphql.Boolean} {
		outputs[s.Name()], inputs[s.Name()] = s, s
	}
	for _, e := range d.Enums {
		vals := graphql.EnumValueConfigMap{}
		for _, v := range e.Values {
			vals[v] = &graphql.EnumValueConfig{Value: v}
		}
		en := graphql.NewEnum(graphql.EnumConfig{Name: e.Name, Description: e.Doc, Values: vals})
		outputs[e.Name], inputs[e.Name] = en, en
	}
	for _, o := range append(d.Objects, rewardTypes...) {
		o := o
		outputs[o.Name] = graphql.NewObject(graphql.ObjectConfig{Name: o.Name, Description: o.Doc,
			Fields: graphql.FieldsThunk(func() graphql.Fields {
				fs := graphql.Fields{}
				for _, f := range o.Fields {
					key := f.JSON
					fs[f.Name] = &graphql.Field{Type: outType(outputs, f.Type), Description: f.Doc,
						Resolve: func(p graphql.ResolveParams) (any, error) {
							if m, ok := p.Source.(map[string]any); ok {
								return m[key], nil
							}
							return nil, nil
						}}
				}
				return fs
			})})
	}
	for _, in := range d.Inputs {
		in := in
		inputs[in.Name] = graphql.NewInputObject(graphql.InputObjectConfig{Name: in.Name, Description: in.Doc,
			Fields: graphql.InputObjectConfigFieldMapThunk(func() graphql.InputObjectConfigFieldMap {
				fs := graphql.InputObjectConfigFieldMap{}
				for _, f := range in.Fields {
					fs[f.Name] = &graphql.InputObjectFieldConfig{Type: inType(inputs, f.Type), Description: f.Doc}
				}
				return fs
			})})
	}
	root := func(name string, defs []fieldDef) *graphql.Object {
		fs := graphql.Fields{}
		for _, r := range defs {
			r := r
			args := graphql.FieldConfigArgument{}
			for _, a := range r.Args {
				args[a.Name] = &graphql.ArgumentConfig{Type: inType(inputs, a.Type), Description: a.Doc}
			}
			fs[r.Name] = &graphql.Field{Type: outType(outputs, r.Type), Description: r.Doc, Args: args,
				Resolve: func(p graphql.ResolveParams) (any, error) { return resolve(p, r.Name) }}
		}
		return graphql.NewObject(graphql.ObjectConfig{Name: name, Fields: fs})
	}
	cfg := graphql.SchemaConfig{Query: root("Query", d.Query)}
	if len(d.Mutation) > 0 {
		cfg.Mutation = root("Mutation", d.Mutation)
	}
	return graphql.NewSchema(cfg)
}

// outType turns "[Zora20Token!]" into the graphql-go type.
func outType(named map[string]graphql.Output, s string) graphql.Output {
	if strings.HasSuffix(s, "!") {
		return graphql.NewNonNull(outType(named, strings.TrimSuffix(s, "!")))
	}
	if strings.HasPrefix(s, "[") {
		return graphql.NewList(outType(named, s[1:len(s)-1]))
	}
	t, ok := named[s]
	if !ok {
		panic(fmt.Sprintf("gateway: unknown output type %q", s))
	}
	return t
}

func inType(named map[string]graphql.Input, s string) graphql.Input {
	if strings.HasSuffix(s, "!") {
		return graphql.NewNonNull(inType(named, strings.TrimSuffix(s, "!")))
	}
	if strings.HasPrefix(s, "[") {
		return graphql.NewList(inType(named, s[1:len(s)-1]))
	}
	t, ok := named[s]
	if !ok {
		panic(fmt.Sprintf("gateway: unknown input type %q", s))
	}
	return t
}

// The rewards types are hand-written (they come from the rewards package, not the spec). They must
// match REWARDS_SDL in codegen/emit_graphql.py.
var rewardTypes = []struct {
	Name   string     `json:"name"`
	Doc    string     `json:"doc"`
	Fields []fieldDef `json:"fields"`
}{
	{"RewardsReport", "What a set of addresses earned, per role and token, valued at current prices.", []fieldDef{
		{Name: "addresses", JSON: "addresses", Type: "[String!]"}, {Name: "events", JSON: "events", Type: "Int"},
		{Name: "fromBlock", JSON: "fromBlock", Type: "Int"}, {Name: "toBlock", JSON: "toBlock", Type: "Int"},
		{Name: "totalUsd", JSON: "totalUsd", Type: "Float"}, {Name: "lines", JSON: "lines", Type: "[RewardLine!]"}}},
	{"RewardLine", "What one role earned in one token.", []fieldDef{
		{Name: "role", JSON: "role", Type: "String"}, {Name: "token", JSON: "token", Type: "String"},
		{Name: "symbol", JSON: "symbol", Type: "String"}, {Name: "raw", JSON: "raw", Type: "String"},
		{Name: "amount", JSON: "amount", Type: "Float"}, {Name: "usd", JSON: "usd", Type: "Float"},
		{Name: "payouts", JSON: "payouts", Type: "Int"}}},
}
