import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function quote(value) {
	return value.includes(' ') ? `"${value}"` : value;
}

async function ask(rl, label, defaultValue = '') {
	const suffix = defaultValue ? ` [${defaultValue}]` : '';
	const value = await rl.question(`${label}${suffix}: `);
	return value.trim() || defaultValue;
}

async function askYesNo(rl, label, defaultValue = false) {
	const hint = defaultValue ? 'Y/n' : 'y/N';
	const value = (await rl.question(`${label} (${hint}): `)).trim().toLowerCase();
	if (!value) return defaultValue;
	return value === 'y' || value === 'yes';
}

function defaultOutput(inputPath, target, translate) {
	const suffix = translate ? target : 'raw';
	const downloadsDir = path.join(process.env.USERPROFILE || process.env.HOME || projectRoot, 'Downloads');
	const base = fs.existsSync(inputPath) && fs.statSync(inputPath).isFile()
		? path.basename(inputPath, path.extname(inputPath))
		: path.basename(path.resolve(inputPath)) || 'quiz';
	return path.join(downloadsDir, `${base}_${suffix}.json`);
}

function runTool(args) {
	console.log('\nRunning:');
	console.log(`node scripts/html-quiz-to-json.mjs ${args.map(quote).join(' ')}\n`);
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ['scripts/html-quiz-to-json.mjs', ...args], {
			cwd: projectRoot,
			stdio: 'inherit'
		});
		child.on('exit', (code) => {
			if (code === 0) resolve();
			else reject(new Error(`Tool exited with code ${code}`));
		});
		child.on('error', reject);
	});
}

async function main() {
	console.log('HTML Quiz -> Importable JSON Tool');
	console.log('--------------------------------');

	const rl = readline.createInterface({ input, output });
	try {
		const inputPath = await ask(rl, 'Input HTML file/folder');
		if (!inputPath) throw new Error('Input is required.');
		if (!fs.existsSync(inputPath)) throw new Error(`Input does not exist: ${inputPath}`);

		const translate = await askYesNo(rl, 'Translate text', false);
		let source = 'en';
		let target = 'vi';
		let language = 'en';
		let glossary = '';

		if (translate) {
			source = await ask(rl, 'Source language', 'en');
			target = await ask(rl, 'Target language', 'vi');
			language = target;
			glossary = await ask(rl, 'Glossary JSON path (optional)', '');
			console.log('\nWarning: translation sends quiz text to Google Translate.');
			const consent = await askYesNo(rl, 'Do you agree to send this text to Google Translate', false);
			if (!consent) throw new Error('Cancelled before translation.');
		} else {
			language = await ask(rl, 'Output language', 'en');
		}

		const outputPath = await ask(rl, 'Output JSON path', defaultOutput(inputPath, target, translate));
		const title = await ask(rl, 'Quiz title', path.basename(outputPath, path.extname(outputPath)));
		const passPercent = await ask(rl, 'Pass percent', '85');

		const args = [
			'--input',
			inputPath,
			'--output',
			outputPath,
			'--title',
			title,
			'--title-vi',
			title,
			'--language',
			language,
			'--pass-percent',
			passPercent
		];

		if (translate) {
			args.push('--translate', '--source', source, '--target', target);
			if (glossary) args.push('--glossary', glossary);
		}

		await runTool(args);
		console.log(`\nDone: ${outputPath}`);
	} finally {
		rl.close();
	}
}

main().catch((error) => {
	console.error(`\nError: ${error instanceof Error ? error.message : error}`);
	process.exitCode = 1;
});
