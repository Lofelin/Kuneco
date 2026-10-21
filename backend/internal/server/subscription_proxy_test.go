package server

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSubscriptionProxyEnvelope(t *testing.T) {
	p := Proxy{Protocol: "vless", Host: "node.example.test", Port: 443, NodeID: strings.Repeat("a", 64), Node: json.RawMessage(`{"type":"vless","server":"node.example.test","port":443,"uuid":"00000000-0000-4000-8000-000000000001","tls":true}`)}
	if !p.Valid() {
		t.Fatal("valid selected node envelope rejected")
	}
	copy := p
	copy.Host = "different.example.test"
	if copy.Valid() {
		t.Fatal("mismatched endpoint accepted")
	}
	copy = p
	copy.Protocol = "http"
	if copy.Valid() {
		t.Fatal("native proxy may not carry an encrypted node")
	}
	copy = p
	copy.Node = json.RawMessage(`{"type":"ss","server":"node.example.test","port":443}`)
	if copy.Valid() {
		t.Fatal("mismatched protocol accepted")
	}
	copy = p
	copy.NodeID = ""
	if copy.Valid() {
		t.Fatal("missing node identity accepted")
	}
}

func TestProxyProfileIdentityRoundTrip(t *testing.T) {
	p := Proxy{ProfileID: "12345678-1234-4234-8234-123456789abc", Protocol: "http", Host: "198.51.100.2", Port: 8080, Password: "test-secret"}
	if !p.Valid() {
		t.Fatal("profile identity rejected")
	}
	b, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	var restored Proxy
	if json.Unmarshal(b, &restored) != nil || restored.ProfileID != p.ProfileID {
		t.Fatal("profile identity lost")
	}
	p.ProfileID = "../../other-account"
	if p.Valid() {
		t.Fatal("unsafe identity accepted")
	}
}
