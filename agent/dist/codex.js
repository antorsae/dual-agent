/**
 * Codex CLI wrapper - spawns codex as subprocess
 */
import { spawn } from "child_process";
import { writeFile } from "fs/promises";
// Color codes
const colors = {
    reset: "\x1b[0m",
    dim: "\x1b[2m",
    cyan: "\x1b[36m",
    yellow: "\x1b[33m",
    green: "\x1b[32m",
    red: "\x1b[31m",
};
function log(msg, color = colors.dim) {
    console.error(`${color}${msg}${colors.reset}`);
}
/**
 * Build a structured prompt for Codex based on task type
 */
function buildPrompt(task) {
    const typeInstructions = {
        review: `Perform a thorough code review. Analyze:
- Bugs, logic errors, edge cases
- Security vulnerabilities
- Performance issues
- Code quality and maintainability

Be specific with file/line references. Provide fixed code examples.`,
        implement: `Implement the requested feature:
- Follow existing code patterns
- Handle edge cases and errors
- Write clean, well-documented code
- Create/modify the necessary files`,
        "plan-review": `Critically analyze this implementation plan:
- Is the approach sound?
- What edge cases are missing?
- Are there simpler alternatives?
- What are the risks?
Provide specific, actionable feedback.`,
        custom: "", // User provides full prompt
    };
    if (task.type === "custom") {
        return task.prompt;
    }
    let prompt = `# Task: ${task.type.toUpperCase()}\n\n`;
    prompt += `${typeInstructions[task.type]}\n\n`;
    prompt += `## Request\n\n${task.prompt}\n`;
    if (task.files?.length) {
        prompt += `\n## Files\n\n`;
        prompt += task.files.map((f) => `- ${f}`).join("\n");
        prompt += `\n\nRead these files and include them in your analysis.`;
    }
    return prompt;
}
/**
 * Run Codex CLI with the given prompt
 */
export async function runCodex(task, options = {}) {
    const { stream = true, timeout = 5 * 60 * 1000 } = options;
    const prompt = buildPrompt(task);
    const cwd = task.cwd || process.cwd();
    log(`[codex] Starting ${task.type} task...`, colors.cyan);
    if (task.files?.length) {
        log(`[codex] Files: ${task.files.join(", ")}`, colors.dim);
    }
    return new Promise((resolve) => {
        const chunks = [];
        // Spawn codex with full-auto mode
        const proc = spawn("codex", ["--full-auto", prompt], {
            cwd,
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, FORCE_COLOR: "0" },
        });
        const timer = setTimeout(() => {
            proc.kill("SIGTERM");
            resolve({
                success: false,
                output: "",
                error: `Codex timed out after ${timeout / 1000}s`,
            });
        }, timeout);
        proc.stdout.on("data", (chunk) => {
            chunks.push(chunk);
            if (stream) {
                process.stdout.write(chunk);
            }
        });
        proc.stderr.on("data", (chunk) => {
            chunks.push(chunk);
            if (stream) {
                process.stderr.write(chunk);
            }
        });
        proc.on("close", (code) => {
            clearTimeout(timer);
            const output = Buffer.concat(chunks).toString();
            if (code === 0) {
                log(`\n[codex] Completed successfully`, colors.green);
                resolve({ success: true, output });
            }
            else {
                log(`\n[codex] Exited with code ${code}`, colors.red);
                resolve({
                    success: false,
                    output,
                    error: `Codex exited with code ${code}`,
                });
            }
        });
        proc.on("error", (err) => {
            clearTimeout(timer);
            log(`[codex] Error: ${err.message}`, colors.red);
            resolve({
                success: false,
                output: "",
                error: err.message,
            });
        });
    });
}
/**
 * Run Codex and write result to a file (for .agent-collab integration)
 */
export async function runCodexToFile(task, outputFile, options = {}) {
    const result = await runCodex(task, options);
    const response = `# Codex Response

## Task Type
${task.type.toUpperCase()}

## Status
${result.success ? "SUCCESS" : "FAILED"}

## Output

${result.output}

${result.error ? `## Error\n\n${result.error}` : ""}
`;
    await writeFile(outputFile, response);
    log(`[codex] Response written to ${outputFile}`, colors.dim);
    return result;
}
