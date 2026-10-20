package secret

import (
	"errors"
	"strings"
	"testing"
)

func TestCipherRoundTripUsesFreshNonce(t *testing.T) {
	c, err := New("unit-test-key-0123456789")
	if err != nil {
		t.Fatal(err)
	}
	a, err := c.Encrypt("P@ssw0rd")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := c.Encrypt("P@ssw0rd")
	if a == b {
		t.Fatal("identical ciphertexts reveal equal secrets")
	}
	if strings.Contains(a, "P@ssw0rd") || !strings.HasPrefix(a, "v1:") {
		t.Fatalf("unexpected ciphertext format: %s", a)
	}
	plain, err := c.Decrypt(a)
	if err != nil || plain != "P@ssw0rd" {
		t.Fatalf("round trip: %q %v", plain, err)
	}
}

func TestCipherRejectsTamperingWrongKeyAndShortKeys(t *testing.T) {
	c, _ := New("unit-test-key-0123456789")
	token, _ := c.Encrypt("secret")
	tampered := token[:len(token)-2] + "AA"
	if _, err := c.Decrypt(tampered); !errors.Is(err, ErrDecrypt) {
		t.Fatalf("tampered ciphertext accepted: %v", err)
	}
	other, _ := New("another-key-0123456789")
	if _, err := other.Decrypt(token); !errors.Is(err, ErrDecrypt) {
		t.Fatalf("wrong key accepted: %v", err)
	}
	if _, err := New("short"); err == nil {
		t.Fatal("short key accepted")
	}
	empty, err := c.Encrypt("")
	if err != nil || empty != "" {
		t.Fatalf("empty secret should stay empty: %q %v", empty, err)
	}
	if plain, err := c.Decrypt(""); err != nil || plain != "" {
		t.Fatalf("empty token: %q %v", plain, err)
	}
}
