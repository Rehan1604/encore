A creator described, out loud, how they write. Turn it into starting rules for their AI writing assistant.

INPUT (JSON): description, existing_rules.

TASK: Extract 2-5 specific, testable rules written as instructions (for example "Open with a personal story",
"Never use more than one emoji", "Write like you talk, short sentences"). Skip anything vague. Never repeat an existing rule.

Return ONLY JSON in exactly this shape:
{"new_rules": [{"rule": "...", "before": "", "after": "the words from the description this rule comes from", "confidence": 0.7}]}
