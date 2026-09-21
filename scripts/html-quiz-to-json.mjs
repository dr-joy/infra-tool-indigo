import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function printHelp() {
	console.log(`HTML quizData -> importable JSON

Usage:
  node scripts/html-quiz-to-json.mjs --input <file-or-folder> [--output <file>] [options]

Options:
  --input <path>          HTML file or folder containing .html files.
  --output <path>         Output JSON file. Default: Downloads/<input>_<target-or-raw>.json.
  --translate             Translate question/answers/explanation through Google Translate.
  --source <lang>         Source language for translation. Default: en.
  --target <lang>         Target language for translation. Default: vi.
  --cache <path>          Translation cache file. Default: <output>.cache.json.
  --title <text>          quiz_title in output. Default: derived from output file.
  --title-vi <text>       quiz_title_vi in output. Default: same as --title.
  --language <code>       language in output. Default: target when translating, else source.
  --pass-percent <num>    pass_percent in output. Default: 85.
  --duration <seconds>    duration_seconds in output. Default: null.
  --glossary <path>       Optional JSON glossary: { "English term": "Target term" }.
  --delay-ms <num>        Delay after each cache flush. Default: 150.
  --help                  Show this help.

Examples:
  node scripts/html-quiz-to-json.mjs --input "D:/PSM2/html" --output psm2_vi.json --translate --target vi
  node scripts/html-quiz-to-json.mjs --input quiz.html --output quiz_raw.json
`);
}

function defaultOutput(inputPath, target, translate) {
	const suffix = translate ? target : 'raw';
	const downloadsDir = path.join(process.env.USERPROFILE || process.env.HOME || projectRoot, 'Downloads');
	const base = fs.existsSync(inputPath) && fs.statSync(inputPath).isFile()
		? path.basename(inputPath, path.extname(inputPath))
		: path.basename(path.resolve(inputPath)) || 'quiz';
	return path.join(downloadsDir, `${base}_${suffix}.json`);
}

function parseArgs(argv) {
	const args = {
		source: 'en',
		target: 'vi',
		translate: false,
		passPercent: 85,
		duration: null,
		delayMs: 150
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const next = () => {
			if (i + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
			return argv[++i];
		};
		switch (arg) {
			case '--help':
			case '-h':
				args.help = true;
				break;
			case '--input':
			case '-i':
				args.input = next();
				break;
			case '--output':
			case '-o':
				args.output = next();
				break;
			case '--translate':
				args.translate = true;
				break;
			case '--source':
				args.source = next();
				break;
			case '--target':
				args.target = next();
				break;
			case '--cache':
				args.cache = next();
				break;
			case '--title':
				args.title = next();
				break;
			case '--title-vi':
				args.titleVi = next();
				break;
			case '--language':
				args.language = next();
				break;
			case '--pass-percent':
				args.passPercent = Number(next());
				break;
			case '--duration':
				args.duration = Number(next());
				break;
			case '--glossary':
				args.glossary = next();
				break;
			case '--delay-ms':
				args.delayMs = Number(next());
				break;
			default:
				throw new Error(`Unknown option: ${arg}`);
		}
	}
	return args;
}

function decodeEntities(input) {
	if (!input) return '';
	return input
		.replace(/&#x27;/g, "'")
		.replace(/&#39;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&nbsp;/g, ' ');
}

function repairMojibake(input) {
	let out = input
		.replace(/\u00e2\u20ac\u2122/g, '\u2019')
		.replace(/\u00e2\u20ac\u0153/g, '\u201c')
		.replace(/\u00e2\u20ac\ufffd/g, '\u201d')
		.replace(/\u00e2\u20ac\u201d/g, '\u2014')
		.replace(/\u00e2\u20ac\u201c/g, '\u2013');
	if (/[ÃÂáºá»]/.test(out)) {
		const repaired = Buffer.from(out, 'latin1').toString('utf8');
		if (!repaired.includes('\ufffd')) out = repaired;
	}
	return out;
}

function stripHtml(input) {
	if (!input) return '';
	return repairMojibake(decodeEntities(
		input
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/p>/gi, '\n')
			.replace(/<[^>]+>/g, '')
	))
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function extractQuizData(html) {
	const marker = html.indexOf('quizData');
	if (marker < 0) throw new Error('quizData not found');
	const eq = html.indexOf('=', marker);
	const start = html.indexOf('{', eq);
	if (start < 0) throw new Error('quizData object not found');

	let depth = 0;
	let end = -1;
	let inStr = false;
	let strCh = '';
	let esc = false;
	for (let i = start; i < html.length; i++) {
		const c = html[i];
		if (inStr) {
			if (esc) esc = false;
			else if (c === '\\') esc = true;
			else if (c === strCh) inStr = false;
		} else if (c === '"' || c === "'") {
			inStr = true;
			strCh = c;
		} else if (c === '{') {
			depth++;
		} else if (c === '}') {
			depth--;
			if (depth === 0) {
				end = i;
				break;
			}
		}
	}
	if (end < 0) throw new Error('quizData object is incomplete');
	return JSON.parse(html.slice(start, end + 1));
}

function extractBalancedDiv(html, start) {
	let depth = 0;
	for (let i = start; i < html.length; i++) {
		const nextOpen = html.indexOf('<div', i);
		const nextClose = html.indexOf('</div>', i);
		if (nextClose < 0) return '';
		if (nextOpen >= 0 && nextOpen < nextClose) {
			depth++;
			i = nextOpen + 3;
		} else {
			depth--;
			i = nextClose + 5;
			if (depth === 0) return html.slice(start, nextClose + 6);
		}
	}
	return '';
}

function extractDivById(chunk, id) {
	const idIndex = chunk.indexOf(`id="${id}"`);
	if (idIndex < 0) return '';
	const start = chunk.lastIndexOf('<div', idIndex);
	if (start < 0) return '';
	return extractBalancedDiv(chunk, start);
}

function extractRenderedUdemyResult(html) {
	const marker = 'id="question-prompt"';
	const starts = [];
	let offset = html.indexOf(marker);
	while (offset >= 0) {
		starts.push(offset);
		offset = html.indexOf(marker, offset + marker.length);
	}
	if (starts.length === 0) throw new Error('No rendered Udemy result questions found');

	const title = stripHtml(html.match(/data-purpose="title"[^>]*>([\s\S]*?)<\/h2>/)?.[1] || '');
	return {
		title,
		questions: starts.map((start, index) => {
			const chunkStart = html.lastIndexOf('result-pane--question-result-pane', start);
			const nextStart = starts[index + 1] || html.indexOf('<div class="app--row--E-WFM app--dashboard', start);
			const chunk = html.slice(chunkStart >= 0 ? chunkStart : start, nextStart >= 0 ? nextStart : html.length);
			const question = stripHtml(extractDivById(chunk, 'question-prompt'));
			const explanation = stripHtml(extractDivById(chunk, 'overall-explanation'));
			const answers = [];
			const correctResponse = [];

			let answerOffset = chunk.indexOf('id="answer-text"');
			while (answerOffset >= 0) {
				const answerStart = chunk.lastIndexOf('<div', answerOffset);
				const answerHtml = answerStart >= 0 ? extractBalancedDiv(chunk, answerStart) : '';
				const paneStart = chunk.lastIndexOf('result-pane--answer-result-pane', answerOffset);
				const answerContext = chunk.slice(paneStart >= 0 ? paneStart : Math.max(0, answerOffset - 1000), answerOffset);
				const answerText = stripHtml(answerHtml);
				if (answerText) {
					const answerIndex = answers.length;
					answers.push(answerText);
					if (/answer-result-pane--answer-correct|Lựa chọn của bạn đúng|Correct answer/i.test(answerContext)) {
						correctResponse.push(String.fromCharCode(97 + answerIndex));
					}
				}
				answerOffset = chunk.indexOf('id="answer-text"', answerOffset + marker.length);
			}

			return {
				assessment_type: correctResponse.length > 1 ? 'multiple-choice' : 'single-choice',
				question,
				answers,
				correct_response: correctResponse,
				explanation,
				section: title
			};
		})
	};
}

function extractQuestionsFromHtml(html) {
	if (html.includes('quizData')) {
		const raw = extractQuizData(html);
		return {
			title: '',
			questions: (raw.questions || []).map(normalizeQuestion)
		};
	}
	return extractRenderedUdemyResult(html);
}

function normalizeQuestion(q) {
	const answers = q.prompt?.answers || [];
	return {
		assessment_type: q.assessment_type,
		question: stripHtml(q.prompt?.question || q.question_plain || ''),
		answers: answers.map((answer) => stripHtml(answer)),
		correct_response: (q.correct_response || []).map((x) => String(x).toLowerCase()),
		explanation: stripHtml(q.prompt?.explanation || ''),
		section: q.section || ''
	};
}

function listHtmlFiles(inputPath) {
	const stat = fs.statSync(inputPath);
	if (stat.isFile()) return [inputPath];
	return fs
		.readdirSync(inputPath)
		.filter((file) => file.toLowerCase().endsWith('.html'))
		.sort()
		.map((file) => path.join(inputPath, file));
}

function loadGlossary(glossaryPath) {
	if (!glossaryPath) return new Map();
	const raw = JSON.parse(fs.readFileSync(glossaryPath, 'utf8'));
	return new Map(Object.entries(raw));
}

function createTermProtector(glossary) {
	const placeholders = [];
	return {
		protect(text) {
			let out = text;
			const terms = [...glossary.keys()].sort((a, b) => b.length - a.length);
			for (const term of terms) {
				const token = `__TERM_${placeholders.length}__`;
				const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				const re = new RegExp(escaped, 'g');
				if (re.test(out)) {
					placeholders.push(glossary.get(term));
					out = out.replace(re, token);
				}
			}
			return out;
		},
		restore(text) {
			return text
				.replace(/__\s*TERM\s*_\s*(\d+)\s*__/g, (_, n) => placeholders[Number(n)] ?? _)
				.replace(/__TERM_(\d+)__/g, (_, n) => placeholders[Number(n)] ?? _);
		}
	};
}

function polishTranslation(text, targetLang, restoreTerms) {
	let out = restoreTerms(text).replace(/\s+/g, ' ').trim();
	if (targetLang === 'ja') {
		out = out
			.replace(/\s+([。、！？])/g, '$1')
			.replace(/\( すべてを選択してください \)/g, '（該当するものをすべて選択してください）')
			.replace(/\( 最良の答えを選択してください \)/g, '（最も適切な答えを1つ選択してください）')
			.replace(/\( ベスト2の回答を選択してください \)/g, '（最も適切な答えを2つ選択してください）')
			.replace(/\( ベスト3の回答を選択してください \)/g, '（最も適切な答えを3つ選択してください）');
	}
	return out;
}

async function translateOne(text, options, protector) {
	const url = new URL('https://translate.googleapis.com/translate_a/single');
	url.searchParams.set('client', 'gtx');
	url.searchParams.set('sl', options.source);
	url.searchParams.set('tl', options.target);
	url.searchParams.set('dt', 't');
	url.searchParams.set('q', protector.protect(text));
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Translate HTTP ${res.status}: ${await res.text()}`);
	const json = await res.json();
	return polishTranslation(
		(json[0] || []).map((item) => item[0] || '').join(''),
		options.target,
		(textToRestore) => protector.restore(textToRestore)
	);
}

async function translateAll(texts, options, glossary) {
	if (!options.translate) return texts;
	const cache = fs.existsSync(options.cache)
		? JSON.parse(fs.readFileSync(options.cache, 'utf8'))
		: {};
	const translated = [];
	const protector = createTermProtector(glossary);
	for (let i = 0; i < texts.length; i++) {
		const text = texts[i];
		if (cache[text]) {
			translated.push(cache[text]);
		} else {
			let value = '';
			for (let attempt = 1; attempt <= 3; attempt++) {
				try {
					value = await translateOne(text, options, protector);
					break;
				} catch (error) {
					if (attempt === 3) throw error;
					await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
				}
			}
			cache[text] = value;
			translated.push(value);
			if (i % 10 === 0) fs.writeFileSync(options.cache, JSON.stringify(cache, null, 2), 'utf8');
		}
		if ((i + 1) % 25 === 0 || i + 1 === texts.length) {
			fs.writeFileSync(options.cache, JSON.stringify(cache, null, 2), 'utf8');
			console.log(`translated ${i + 1}/${texts.length}`);
			await new Promise((resolve) => setTimeout(resolve, options.delayMs));
		}
	}
	return translated;
}

function validateOutput(output) {
	if (!Array.isArray(output.questions) || output.questions.length === 0) {
		throw new Error('Output has no questions');
	}
	for (const [index, q] of output.questions.entries()) {
		if (!q.question) throw new Error(`Question ${index + 1} has empty question text`);
		if (!Array.isArray(q.answers) || q.answers.length < 2) {
			throw new Error(`Question ${index + 1} has fewer than 2 answers`);
		}
		if (!Array.isArray(q.correct_response)) {
			throw new Error(`Question ${index + 1} has invalid correct_response`);
		}
	}
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		printHelp();
		return;
	}
	if (!options.input) throw new Error('Missing --input');

	options.input = path.resolve(options.input);
	options.output = options.output || defaultOutput(options.input, options.target, options.translate);
	options.output = path.resolve(options.output);
	options.cache = path.resolve(options.cache || `${options.output.replace(/\.json$/i, '')}.cache.json`);
	options.title = options.title || path.basename(options.output, path.extname(options.output));
	options.titleVi = options.titleVi || options.title;
	options.language = options.language || (options.translate ? options.target : options.source);

	const files = listHtmlFiles(options.input);
	if (files.length === 0) throw new Error(`No HTML files found in ${options.input}`);

	const sourceQuestions = [];
	for (const filePath of files) {
		const raw = extractQuestionsFromHtml(fs.readFileSync(filePath, 'utf8'));
		const before = sourceQuestions.length;
		for (const q of raw.questions || []) {
			const normalized = q.prompt ? normalizeQuestion(q) : q;
			if (!normalized.question || normalized.answers.length < 2) continue;
			sourceQuestions.push({ ...normalized, source_file: path.basename(filePath) });
		}
		console.log(`${path.basename(filePath)}: ${sourceQuestions.length - before} questions`);
	}
	console.log(`Total parsed questions: ${sourceQuestions.length}`);

	const texts = [];
	const slots = [];
	for (const [qi, q] of sourceQuestions.entries()) {
		slots.push({ qi, field: 'question' });
		texts.push(q.question);
		q.answers.forEach((_answer, ai) => {
			slots.push({ qi, field: 'answer', ai });
			texts.push(q.answers[ai]);
		});
		if (q.explanation) {
			slots.push({ qi, field: 'explanation' });
			texts.push(q.explanation);
		}
	}
	console.log(`Total text segments: ${texts.length}`);

	const glossary = loadGlossary(options.glossary);
	const translated = await translateAll(texts, options, glossary);

	const outputQuestions = sourceQuestions.map((q) => ({
		assessment_type: q.assessment_type,
		question: q.question,
		answers: [...q.answers],
		correct_response: q.correct_response,
		explanation: q.explanation,
		source_file: q.source_file,
		section: q.section
	}));

	for (let i = 0; i < slots.length; i++) {
		const slot = slots[i];
		const value = translated[i];
		const q = outputQuestions[slot.qi];
		if (slot.field === 'question') q.question = value;
		else if (slot.field === 'answer') q.answers[slot.ai] = value;
		else if (slot.field === 'explanation') q.explanation = value;
	}

	const output = {
		source_file: files.map((file) => path.basename(file)).join(', '),
		quiz_title: options.title,
		quiz_title_vi: options.titleVi,
		pass_percent: options.passPercent,
		duration_seconds: options.duration,
		language: options.language,
		questions: outputQuestions
	};

	validateOutput(output);
	fs.mkdirSync(path.dirname(options.output), { recursive: true });
	fs.writeFileSync(options.output, JSON.stringify(output, null, 2), 'utf8');
	console.log(`Wrote ${outputQuestions.length} questions to ${options.output}`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
