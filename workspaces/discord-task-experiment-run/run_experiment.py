#!/usr/bin/env python3
"""Quantile-calibration experiment runner.

For each question: 4 quantile elicitations (80/95 x lower/upper) + 1 point
estimate, each a fresh-context `claude -p` call. Results appended to a JSONL
cache as they arrive; already-cached (model, qid, condition) calls are skipped,
so the script is resumable.
"""
import argparse, json, re, subprocess, sys, threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

WORKDIR = Path(__file__).parent
SYSTEM_PROMPT = (
    "You are a careful quantitative estimator. Provide brief reasoning if useful, "
    "but you MUST end your response with a single JSON object of the form "
    '{"X": <number>} and nothing after it. Scientific notation is allowed '
    "(e.g. 3.2e7). Do not include units in the JSON."
)
DISALLOWED = "WebSearch,WebFetch,Bash,Read,Glob,Grep,Task,Edit,Write,NotebookEdit,TodoWrite"

LEVELS = [80, 95]
DIRECTIONS = ["lower", "upper"]

JSON_RE = re.compile(r'\{\s*"X"\s*:\s*([-+0-9.eE]+)\s*\}')


def build_prompt(question, level, direction):
    if direction == "point":
        return (f"Question: {question}\n"
                f'Give your single best point estimate of the true answer. End with {{"X": <number>}}.')
    word = "LARGER" if direction == "lower" else "SMALLER"
    return (f"Question: {question}\n"
            f"Give the value X such that you are {level}% confident the true answer is "
            f'{word} than X. End with {{"X": <number>}}.')


def call_model(model, prompt, retry_note=None):
    p = prompt if retry_note is None else prompt + "\n\n" + retry_note
    r = subprocess.run(
        ["claude", "-p", p, "--model", model,
         "--system-prompt", SYSTEM_PROMPT,
         "--disallowedTools", DISALLOWED],
        capture_output=True, text=True, timeout=300)
    return r.stdout.strip(), r.returncode


def parse_x(text):
    matches = JSON_RE.findall(text)
    if not matches:
        return None
    try:
        return float(matches[-1])
    except ValueError:
        return None


def run_one(model, q, level, direction):
    prompt = build_prompt(q["question"], level, direction)
    out, rc = call_model(model, prompt)
    x = parse_x(out)
    retried = False
    if x is None:
        retried = True
        out, rc = call_model(model, prompt,
            'REMINDER: you MUST end with a single JSON object {"X": <number>} and nothing after it.')
        x = parse_x(out)
    return {"model": model, "qid": q["id"], "bucket": q["bucket"],
            "level": level, "direction": direction, "X": x,
            "truth": q["truth"], "retried": retried,
            "raw_tail": out[-300:] if x is None else None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="claude-haiku-4-5")
    ap.add_argument("--questions", nargs="+",
                    default=[str(WORKDIR / "questions_bucketA.json"),
                             str(WORKDIR / "questions_bucketB.json")])
    ap.add_argument("--out", default=str(WORKDIR / "results.jsonl"))
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--limit", type=int, default=None,
                    help="only first N questions per file (smoke test)")
    args = ap.parse_args()

    questions = []
    for f in args.questions:
        qs = json.loads(Path(f).read_text())
        questions.extend(qs[:args.limit] if args.limit else qs)

    out_path = Path(args.out)
    done = set()
    if out_path.exists():
        for line in out_path.read_text().splitlines():
            try:
                r = json.loads(line)
                done.add((r["model"], r["qid"], r["level"], r["direction"]))
            except json.JSONDecodeError:
                pass

    jobs = []
    for q in questions:
        for lv in LEVELS:
            for d in DIRECTIONS:
                if (args.model, q["id"], lv, d) not in done:
                    jobs.append((q, lv, d))
        if (args.model, q["id"], 0, "point") not in done:
            jobs.append((q, 0, "point"))

    print(f"{len(questions)} questions, {len(jobs)} calls to make "
          f"({len(done)} cached)", flush=True)

    lock = threading.Lock()
    n_done = 0
    with out_path.open("a") as fh, ThreadPoolExecutor(args.workers) as ex:
        futs = {ex.submit(run_one, args.model, q, lv, d): (q["id"], lv, d)
                for q, lv, d in jobs}
        for fut in as_completed(futs):
            qid, lv, d = futs[fut]
            try:
                rec = fut.result()
            except Exception as e:
                rec = {"model": args.model, "qid": qid, "level": lv,
                       "direction": d, "X": None, "error": str(e)}
            with lock:
                fh.write(json.dumps(rec) + "\n")
                fh.flush()
                n_done += 1
                flag = "" if rec.get("X") is not None else "  <-- PARSE FAIL"
                print(f"[{n_done}/{len(jobs)}] {qid} {lv} {d}: X={rec.get('X')}{flag}",
                      flush=True)
    print("done", flush=True)


if __name__ == "__main__":
    main()
