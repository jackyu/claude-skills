"""從 transcript 算一個任務各階段的 token 用量；/mission-cost 呼叫。

stdin 收 JSON：{"sessions": [id 或 8 碼以上前綴], "stages": [{"label", "from"}], "until"}，
時間都是 epoch 毫秒。stdout 回 JSON，每個階段分主對話（main）和 subagent（sub）兩組。
transcript 動輒幾十 MB，超過 mod 的 $.fs.read 上限，所以放在這裡用 python 讀。
"""
import datetime
import glob
import json
import os
import sys

FIELDS = ('input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens')


def empty():
    return {'calls': 0, **{f: 0 for f in FIELDS}}


def to_ms(stamp):
    return datetime.datetime.fromisoformat(stamp.replace('Z', '+00:00')).timestamp() * 1000


def find_transcript(root, session):
    # 主 checkout 和各個 worktree 的 transcript 在不同的 project 目錄，所以跨目錄找
    matches = sorted(glob.glob(os.path.join(glob.escape(root), '*', glob.escape(session) + '*.jsonl')))
    return matches


def stage_index(stages, at):
    found = None
    for i, stage in enumerate(stages):
        if at >= stage['from']:
            found = i
    return found


def add_file(path, who, stages, until, totals):
    # 同一則回應會拆成好幾行寫進 transcript，usage 重複出現，用 message.id 只算一次
    seen = set()
    with open(path, encoding='utf-8', errors='ignore') as handle:
        for line in handle:
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if row.get('type') != 'assistant':
                continue
            message = row.get('message') or {}
            usage = message.get('usage')
            message_id = message.get('id')
            if not usage or message_id in seen or 'timestamp' not in row:
                continue
            seen.add(message_id)
            at = to_ms(row['timestamp'])
            if at >= until:
                continue
            index = stage_index(stages, at)
            if index is None:
                continue
            bucket = totals[index][who]
            bucket['calls'] += 1
            for field in FIELDS:
                bucket[field] += usage.get(field, 0) or 0


def main():
    request = json.load(sys.stdin)
    root = os.environ.get('MISSION_COST_PROJECTS') or os.path.expanduser('~/.claude/projects')
    stages = request['stages']
    totals = [{'main': empty(), 'sub': empty()} for _ in stages]
    missing, ambiguous, used = [], [], []
    for session in request['sessions']:
        matches = find_transcript(root, session)
        if not matches:
            missing.append(session)
            continue
        if len(matches) > 1:
            ambiguous.append(session)
            continue
        main_file = matches[0]
        used.append(os.path.basename(main_file)[:-len('.jsonl')])
        add_file(main_file, 'main', stages, request['until'], totals)
        for sub in sorted(glob.glob(os.path.join(glob.escape(main_file[:-len('.jsonl')]), 'subagents', '*.jsonl'))):
            add_file(sub, 'sub', stages, request['until'], totals)
    result = {
        'used': used,
        'missing': missing,
        'ambiguous': ambiguous,
        'stages': [{'label': s['label'], **totals[i]} for i, s in enumerate(stages)],
    }
    json.dump(result, sys.stdout, ensure_ascii=False)


if __name__ == '__main__':
    main()
