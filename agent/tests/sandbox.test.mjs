import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createScratch, readOnlyCodexArgs, scratchEnvironment } from "../dist/scratch.js";

// Explicit opt-in: executes the installed sandbox without submitting a model request.
test("native Codex sandbox runs pytest and SQLite in scratch while blocking workspace and symlink writes", {
  skip: !process.env.DUAL_AGENT_SANDBOX_BIN,
}, async t => {
  const root = await mkdtemp(join(tmpdir(), "dual-agent-sandbox-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, "project");
  const jobDirectory = join(root, "job with 'quotes'");
  const other = join(root, "other");
  await Promise.all([project, jobDirectory, other].map(path => mkdir(path)));
  const scratch = await createScratch(project, jobDirectory);
  await symlink(project, join(scratch, "workspace-link"), "dir");
  await writeFile(join(project, "source.py"), "VALUE = 42\n");
  const testSource = `import os, pathlib, sqlite3
def test_fixture(tmp_path):
    assert tmp_path.is_relative_to(pathlib.Path(os.environ['TMPDIR']))
    with sqlite3.connect(tmp_path / 'fixture.db') as db:
        db.execute('create table fixture (value integer)')
        db.execute('insert into fixture values (42)')
        assert db.execute('select value from fixture').fetchone()[0] == 42
`;
  await writeFile(join(project, "test_fixture.py"), testSource);
  await writeFile(join(jobDirectory, "job.json"), "metadata\n");
  const id = randomUUID();
  const workerArgs = readOnlyCodexArgs({ id, scratch });
  const configArgs = workerArgs.filter((arg, i) => arg === "-c" || workerArgs[i - 1] === "-c");
  const profile = JSON.parse(configArgs.find(arg => arg.startsWith("default_permissions=")).split("=")[1]);
  const python = process.env.DUAL_AGENT_TEST_PYTHON || "python3";
  const probe = `import json, os, pathlib, py_compile, sqlite3, subprocess, sys, tempfile
project = pathlib.Path.cwd()
scratch = pathlib.Path(os.environ['DUAL_AGENT_SCRATCH_DIR'])
assert (project / 'source.py').read_text() == 'VALUE = 42\\n'
with tempfile.TemporaryDirectory() as temporary:
    assert pathlib.Path(temporary).is_relative_to(scratch)
    with sqlite3.connect(pathlib.Path(temporary) / 'probe.db') as db:
        assert db.execute('select 42').fetchone() == (42,)
py_compile.compile(str(project / 'source.py'), doraise=True)
for target in [project / 'blocked.txt', project / 'source.py',
               scratch / 'workspace-link/blocked.txt', scratch.parent / 'job.json',
               pathlib.Path(os.environ['SANDBOX_OTHER']) / 'blocked.txt']:
    try:
        target.write_text('must be blocked')
    except OSError:
        pass
    else:
        raise AssertionError('Sandbox allowed a write outside scratch: ' + str(target))
completed = subprocess.run([sys.executable, '-m', 'pytest', '-q', '-o', 'addopts=', 'test_fixture.py'])
assert completed.returncode == 0
assert (scratch / 'pytest-cache').is_dir()
assert (scratch / 'pycache').is_dir()
assert not (project / '.pytest_cache').exists()
assert not (project / '__pycache__').exists()
print('SCRATCH_SANDBOX_OK')
`;
  const result = spawnSync(process.env.DUAL_AGENT_SANDBOX_BIN, [
    "sandbox", "-P", profile, "--include-managed-config", "-C", project, ...configArgs, "--", python, "-c", probe,
  ], {
    env: { ...process.env, ...scratchEnvironment(scratch), SANDBOX_OTHER: other, PYTEST_DISABLE_PLUGIN_AUTOLOAD: "1" },
    encoding: "utf8", timeout: 60000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /1 passed/);
  assert.match(result.stdout, /SCRATCH_SANDBOX_OK/);
  assert.equal(await readFile(join(project, "source.py"), "utf8"), "VALUE = 42\n");
  assert.equal(await readFile(join(project, "test_fixture.py"), "utf8"), testSource);
  assert.equal(await readFile(join(jobDirectory, "job.json"), "utf8"), "metadata\n");
});
