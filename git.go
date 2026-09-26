package main

import (
	"os/exec"
	"strings"
)

func git(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

// commit stages everything in the data repo and commits it. An empty change is not an error.
func commit(dir, msg string) error {
	if _, err := git(dir, "add", "-A"); err != nil {
		return err
	}
	if _, err := git(dir, "diff", "--cached", "--quiet"); err == nil {
		return nil
	}
	_, err := git(dir, "commit", "-q", "-m", msg)
	return err
}

func hasRemote(dir string) bool {
	out, err := git(dir, "remote")
	return err == nil && out != ""
}

func push(dir string) (string, error) {
	if !hasRemote(dir) {
		return "no remote set", nil
	}
	return git(dir, "push", "-q", "-u", "origin", "HEAD")
}
