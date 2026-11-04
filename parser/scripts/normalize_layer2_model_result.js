'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const RESULTS_DIR = path.join(REPO_ROOT, 'parser/output/layer2_results');

const MODEL_OUTPUTS = Object.freeze({
  gpt: 'gpt_result.json',
  claude: 'claude_result.json',
  gemini: 'gemini_result.json',
});

function printUsage() {
  const scriptPath = path.relative(REPO_ROOT, __filename);
  console.log(`Usage:
  node ${scriptPath} --model <gpt|claude|gemini> --input <raw-output.txt> [--dry-run]
  cat <raw-output.txt> | node ${scriptPath} --model <gpt|claude|gemini> [--dry-run]

Description:
  Converts a pasted model response into strict JSON and writes it to the evaluator input path:
    parser/output/layer2_results/gpt_result.json
    parser/output/layer2_results/claude_result.json
    parser/output/layer2_results/gemini_result.json

Notes:
  - The final JSON files are intentionally ignored by Git.
  - If the response contains markdown fences or surrounding commentary, the script extracts the first valid JSON object/array.
  - Use --dry-run to validate and print normalized JSON without writing a file.`);
}

function parseArgs(argv) {
  const args = {
    model: null,
    inputPath: null,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--model') {
      args.model = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--model=')) {
      args.model = arg.slice('--model='.length);
    } else if (arg === '--input') {
      args.inputPath = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--input=')) {
      args.inputPath = arg.slice('--input='.length);
    } else {
      throw new Error(`알 수 없는 인자입니다: ${arg}`);
    }
  }

  if (args.model) args.model = String(args.model).toLowerCase();
  return args;
}

function readStdin() {
  return fs.readFileSync(0, 'utf8');
}

function readInput(inputPath) {
  if (!inputPath) return readStdin();
  return fs.readFileSync(path.resolve(process.cwd(), inputPath), 'utf8');
}

function stripUtf8Bom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function collectFenceCandidates(text) {
  const candidates = [];
  const fencePattern = /```(?:json|JSON)?\s*([\s\S]*?)```/g;
  let match = fencePattern.exec(text);
  while (match) {
    candidates.push(match[1].trim());
    match = fencePattern.exec(text);
  }
  return candidates;
}

function findMatchingJsonEnd(text, startIndex) {
  const opening = text[startIndex];
  const closing = opening === '{' ? '}' : ']';
  const stack = [opening];
  let inString = false;
  let escaped = false;

  for (let index = startIndex + 1; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{' || char === '[') {
      stack.push(char);
    } else if (char === '}' || char === ']') {
      const expected = stack[stack.length - 1] === '{' ? '}' : ']';
      if (char !== expected) {
        return -1;
      }
      stack.pop();
      if (stack.length === 0) {
        return text[index] === closing ? index : -1;
      }
    }
  }

  return -1;
}

function collectBalancedJsonCandidates(text) {
  const candidates = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char !== '{' && char !== '[') continue;
    const endIndex = findMatchingJsonEnd(text, index);
    if (endIndex === -1) continue;
    candidates.push(text.slice(index, endIndex + 1).trim());
    index = endIndex;
  }
  return candidates;
}

function parseJsonCandidate(candidate) {
  try {
    return { ok: true, value: JSON.parse(candidate), error: null };
  } catch (error) {
    return { ok: false, value: null, error };
  }
}

function parseModelResponse(rawText) {
  const text = stripUtf8Bom(rawText).trim();
  if (!text) {
    throw new Error('입력 텍스트가 비어 있습니다.');
  }

  const directParse = parseJsonCandidate(text);
  if (directParse.ok) return directParse.value;

  const candidates = [
    ...collectFenceCandidates(text),
    ...collectBalancedJsonCandidates(text),
  ];

  for (const candidate of candidates) {
    const result = parseJsonCandidate(candidate);
    if (result.ok) return result.value;
  }

  throw new Error(`strict JSON으로 변환할 수 없습니다. JSON.parse 오류: ${directParse.error.message}`);
}

function assertModel(model) {
  if (!Object.prototype.hasOwnProperty.call(MODEL_OUTPUTS, model || '')) {
    throw new Error('--model은 gpt, claude, gemini 중 하나여야 합니다.');
  }
}

function writeOutput(model, value, dryRun) {
  const normalizedJson = `${JSON.stringify(value, null, 2)}\n`;
  const outputPath = path.join(RESULTS_DIR, MODEL_OUTPUTS[model]);

  if (dryRun) {
    process.stdout.write(normalizedJson);
    return outputPath;
  }

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(outputPath, normalizedJson, 'utf8');
  return outputPath;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  assertModel(args.model);
  const rawText = readInput(args.inputPath);
  const parsed = parseModelResponse(rawText);
  const outputPath = writeOutput(args.model, parsed, args.dryRun);

  if (!args.dryRun) {
    console.log(`strict JSON 저장 완료: ${path.relative(REPO_ROOT, outputPath)}`);
    console.log('주의: parser/output/layer2_results/*.json 파일은 Git에 포함하지 않습니다.');
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`오류: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  parseModelResponse,
};
