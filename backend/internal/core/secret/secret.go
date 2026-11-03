package secret

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
)

const DevKey = "infranexus-dev-encryption-key-change-me"

const prefix = "v1:"

var ErrDecrypt = errors.New("secret: decrypt failed")

type Cipher struct {
	aead cipher.AEAD
}

func New(key string) (*Cipher, error) {
	if len(key) < 16 {
		return nil, errors.New("secret: encryption key must be at least 16 characters")
	}
	sum := sha256.Sum256([]byte(key))
	block, err := aes.NewCipher(sum[:])
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Cipher{aead: aead}, nil
}

func (c *Cipher) Encrypt(plain string) (string, error) {
	if plain == "" {
		return "", nil
	}
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := c.aead.Seal(nonce, nonce, []byte(plain), nil)
	return prefix + base64.RawStdEncoding.EncodeToString(sealed), nil
}

func (c *Cipher) Decrypt(token string) (string, error) {
	if token == "" {
		return "", nil
	}
	raw, err := base64.RawStdEncoding.DecodeString(strings.TrimPrefix(token, prefix))
	if !strings.HasPrefix(token, prefix) || err != nil || len(raw) < c.aead.NonceSize() {
		return "", ErrDecrypt
	}
	nonce, sealed := raw[:c.aead.NonceSize()], raw[c.aead.NonceSize():]
	plain, err := c.aead.Open(nil, nonce, sealed, nil)
	if err != nil {
		return "", ErrDecrypt
	}
	return string(plain), nil
}
