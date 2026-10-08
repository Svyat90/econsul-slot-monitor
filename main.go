package main

import (
	"net/http"
)

func main() {
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "./slots.html")
	})

	http.ListenAndServe(":3000", nil)
}
