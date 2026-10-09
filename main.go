package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
)

// Schedule changes noticed by slots.html during monitoring, one JSON object per line
const scheduleLogPath = "logs/schedule-changes.jsonl"

var scheduleLogMu sync.Mutex

func appendScheduleLog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "cannot read body", http.StatusBadRequest)
		return
	}
	var line bytes.Buffer
	if err := json.Compact(&line, body); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	line.WriteByte('\n')

	scheduleLogMu.Lock()
	defer scheduleLogMu.Unlock()
	if err := os.MkdirAll(filepath.Dir(scheduleLogPath), 0o755); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	f, err := os.OpenFile(scheduleLogPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer f.Close()
	if _, err := f.Write(line.Bytes()); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func main() {
	// Locations directory used by slots.html to fill the country/institution/service dropdowns
	http.HandleFunc("/locations.json", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "./server/data/locations.json")
	})

	http.HandleFunc("/schedule-log", appendScheduleLog)

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "./slots.html")
	})

	http.ListenAndServe(":3000", nil)
}
