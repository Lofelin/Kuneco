package server

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"testing"
)

func TestAvatarUploadSizeBoundary(t *testing.T) {
	s := testServer(t)
	_, token := login(t, s, "avatar-limit")
	var pngData bytes.Buffer
	if err := png.Encode(&pngData, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	for _, size := range []int{512*1024 + 1, maxAvatarBytes, maxAvatarBytes + 1} {
		data := make([]byte, size)
		copy(data, pngData.Bytes())
		body, _ := json.Marshal(map[string]string{"avatar": "data:image/png;base64," + base64.StdEncoding.EncodeToString(data)})
		res := request(s, "PUT", "/v1/me/profile", string(body), token)
		want := 200
		if size > maxAvatarBytes {
			want = 400
		}
		if res.Code != want {
			t.Fatalf("size %d: got %d, want %d: %s", size, res.Code, want, res.Body.String())
		}
		if size > maxAvatarBytes && !bytes.Contains(res.Body.Bytes(), []byte("1 MB")) {
			t.Fatal("missing size error")
		}
	}
	res := request(s, "GET", "/v1/me/avatar", "", token)
	if res.Code != 200 || res.Body.Len() != maxAvatarBytes {
		t.Fatal("rejected upload changed saved avatar")
	}
}
