package api

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"easyproxy/internal/store"
	"golang.org/x/crypto/bcrypt"
)

func TestChangePassword(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	oldHash, err := bcrypt.GenerateFromPassword([]byte("old-password"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.SetSetting("password_hash", string(oldHash)); err != nil {
		t.Fatal(err)
	}
	if err := st.SetSetting("must_change_password", "1"); err != nil {
		t.Fatal(err)
	}

	srv := New(st, t.TempDir(), "test")
	srv.mustChangePw.Store(true)
	req := httptest.NewRequest(http.MethodPost, "/api/password", bytes.NewBufferString(`{"old_password":"old-password","new_password":"new-password"}`))
	rec := httptest.NewRecorder()
	srv.handleChangePassword(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if err := bcrypt.CompareHashAndPassword([]byte(st.GetSetting("password_hash", "")), []byte("new-password")); err != nil {
		t.Fatalf("new password was not stored: %v", err)
	}
	if st.GetSettingBool("must_change_password", true) || srv.mustChangePw.Load() {
		t.Fatal("password change flag was not cleared")
	}
}

func TestDesktopBootstrapSetsPasswordAndSession(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	srv := NewWithOptions(st, t.TempDir(), "test", Options{DesktopMode: true})
	srv.InitPassword()

	getReq := httptest.NewRequest(http.MethodGet, "/api/bootstrap", nil)
	getRec := httptest.NewRecorder()
	srv.handleBootstrap(getRec, getReq)
	if getRec.Code != http.StatusOK || getRec.Body.String() == "" {
		t.Fatalf("bootstrap status=%d body=%s", getRec.Code, getRec.Body.String())
	}

	postReq := httptest.NewRequest(http.MethodPost, "/api/bootstrap", bytes.NewBufferString(`{"password":"desktop-password"}`))
	postRec := httptest.NewRecorder()
	srv.handleBootstrap(postRec, postReq)
	if postRec.Code != http.StatusOK {
		t.Fatalf("bootstrap post status=%d body=%s", postRec.Code, postRec.Body.String())
	}
	cookies := postRec.Result().Cookies()
	if len(cookies) == 0 || cookies[0].Name != sessionCookie {
		t.Fatalf("bootstrap did not create a session cookie: %#v", cookies)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(st.GetSetting("password_hash", "")), []byte("desktop-password")); err != nil {
		t.Fatalf("desktop password was not stored: %v", err)
	}

	second := httptest.NewRecorder()
	srv.handleBootstrap(second, httptest.NewRequest(http.MethodPost, "/api/bootstrap", bytes.NewBufferString(`{"password":"another-password"}`)))
	if second.Code != http.StatusConflict {
		t.Fatalf("second bootstrap status=%d body=%s", second.Code, second.Body.String())
	}
}
