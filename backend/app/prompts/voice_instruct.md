A creator spoke an instruction about one of their social posts. Apply it, and learn from it.

INPUT (JSON): post (the current text), platform, instruction (spoken out loud, may be casual or Hinglish), existing_rules.

TASK
1. Rewrite the post following the instruction exactly. Keep everything the instruction does not touch. Do not invent facts or numbers.
2. If the instruction reveals a lasting preference (for example "never use emojis", "always open with the number",
   "I hate the word excited", "keep it to three lines"), turn it into 1-2 specific, testable rules written as instructions.
   A one-off change ("change Tuesday to Wednesday") creates no rule. Never repeat an existing rule.

Return ONLY JSON in exactly this shape:
{"rewritten": "the full rewritten post", "new_rules": [{"rule": "...", "confidence": 0.8}]}
