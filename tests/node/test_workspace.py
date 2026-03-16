"""Tests for workspace management."""

from pathlib import Path
from moltforge.node.workspace import generate_diff, get_changed_files


def test_generate_diff_on_clean_repo(tmp_path: Path):
    """A clean git repo should produce an empty diff."""
    import subprocess
    subprocess.run(["git", "init", str(tmp_path)], check=True, capture_output=True)
    # Create a file and commit it so the repo isn't empty
    (tmp_path / "hello.txt").write_text("hello")
    subprocess.run(["git", "add", "."], cwd=str(tmp_path), check=True, capture_output=True)
    subprocess.run(
        ["git", "commit", "-m", "init"],
        cwd=str(tmp_path), check=True, capture_output=True,
        env={"GIT_AUTHOR_NAME": "test", "GIT_AUTHOR_EMAIL": "test@test.com",
             "GIT_COMMITTER_NAME": "test", "GIT_COMMITTER_EMAIL": "test@test.com",
             "PATH": subprocess.os.environ.get("PATH", "")},
    )
    assert generate_diff(tmp_path) == ""


def test_get_changed_files_empty_on_clean(tmp_path: Path):
    """No changed files in a clean repo."""
    import subprocess
    subprocess.run(["git", "init", str(tmp_path)], check=True, capture_output=True)
    (tmp_path / "hello.txt").write_text("hello")
    subprocess.run(["git", "add", "."], cwd=str(tmp_path), check=True, capture_output=True)
    subprocess.run(
        ["git", "commit", "-m", "init"],
        cwd=str(tmp_path), check=True, capture_output=True,
        env={"GIT_AUTHOR_NAME": "test", "GIT_AUTHOR_EMAIL": "test@test.com",
             "GIT_COMMITTER_NAME": "test", "GIT_COMMITTER_EMAIL": "test@test.com",
             "PATH": subprocess.os.environ.get("PATH", "")},
    )
    assert get_changed_files(tmp_path) == []
