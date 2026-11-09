"""Read-only local ONNX scoring worker. Input and output stay on stdio."""

import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer


def main(folder):
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    model = ort.InferenceSession(
        str(folder / "model_quint8_avx2.onnx"),
        options,
        providers=["CPUExecutionProvider"],
    )
    tokenizer = Tokenizer.from_file(str(folder / "tokenizer.json"))
    tokenizer.enable_truncation(max_length=256)
    tokenizer.enable_padding(pad_id=1, pad_token="<pad>")
    fields = {
        "input_ids": "ids",
        "attention_mask": "attention_mask",
        "token_type_ids": "type_ids",
    }
    inputs = {item.name: fields[item.name] for item in model.get_inputs()}
    print(json.dumps({"ready": True, "runtime": ort.__version__}), flush=True)
    for line in sys.stdin:
        query, passages = json.loads(line)
        if not 1 <= len(passages) <= 72:
            raise ValueError("Quantidade inválida de candidatos")
        scores = []
        for start in range(0, len(passages), 8):
            batch = tokenizer.encode_batch(
                [(query, passage) for passage in passages[start : start + 8]]
            )
            features = {
                name: np.array([getattr(row, field) for row in batch], dtype=np.int64)
                for name, field in inputs.items()
            }
            logits = model.run(["logits"], features)[0].reshape(-1)
            if len(logits) != len(batch) or not np.isfinite(logits).all():
                raise ValueError("Saída inválida do modelo ONNX")
            scores.extend(logits.tolist())
        print(json.dumps(scores), flush=True)


if __name__ == "__main__":
    main(Path(sys.argv[1]))
