import { createHash } from 'node:crypto';
import type { GitHub } from '@/core/github/client';
import { fromBase64, utf8 } from '@/core/security/crypto';

type Tree = Map<string, { sha: string; mode: string }>;

const sha1 = (s: string | Buffer) => createHash('sha1').update(s).digest('hex');
const blobSha = (b: Uint8Array) => sha1(Buffer.concat([Buffer.from(`blob ${b.length}\0`), Buffer.from(b)]));
const notFound = () => Object.assign(new Error('Not Found'), { status: 404 });

/** In-memory GitHub implementing just the Git Data / contents endpoints HALCYX uses. */
export class FakeGitHub {
  blobs = new Map<string, Uint8Array>();
  trees = new Map<string, Tree>();
  commits = new Map<string, { tree: string; parents: string[]; message: string }>();
  refs = new Map<string, string>();
  pulls: { head: string; base: string; title: string; body: string }[] = [];
  requests: { method: string; body: unknown }[] = [];
  baseSha: string;

  constructor(files: Record<string, string>) {
    const tree: Tree = new Map();
    for (const [path, text] of Object.entries(files)) {
      const bytes = utf8.encode(text);
      const s = blobSha(bytes);
      this.blobs.set(s, bytes);
      tree.set(path, { sha: s, mode: '100644' });
    }
    const treeSha = sha1(JSON.stringify([...tree]));
    this.trees.set(treeSha, tree);
    this.baseSha = sha1(`commit-${treeSha}`);
    this.commits.set(this.baseSha, { tree: treeSha, parents: [], message: 'initial' });
    this.refs.set('main', this.baseSha);
  }

  private log(method: string, body: unknown) {
    this.requests.push({ method, body });
  }

  fileAt(commitSha: string, path: string): string | null {
    const c = this.commits.get(commitSha)!;
    const e = this.trees.get(c.tree)!.get(path);
    return e ? utf8.decode(this.blobs.get(e.sha)!) : null;
  }

  asClient(): GitHub {
    const self = this;
    const git = {
      async getRef({ ref }: { ref: string }) {
        const sha = self.refs.get(ref.replace(/^heads\//, ''));
        if (!sha) throw notFound();
        return { data: { object: { sha } } };
      },
      async getCommit({ commit_sha }: { commit_sha: string }) {
        const c = self.commits.get(commit_sha);
        if (!c) throw notFound();
        return { data: { tree: { sha: c.tree } } };
      },
      async getTree({ tree_sha }: { tree_sha: string }) {
        const t = self.trees.get(tree_sha)!;
        return {
          data: { truncated: false, tree: [...t].map(([path, e]) => ({ path, sha: e.sha, mode: e.mode, type: 'blob' })) },
        };
      },
      async getBlob({ file_sha }: { file_sha: string }) {
        return { data: { content: Buffer.from(self.blobs.get(file_sha)!).toString('base64') } };
      },
      async createBlob(body: { content: string }) {
        self.log('createBlob', body);
        const bytes = fromBase64(body.content);
        const s = blobSha(bytes);
        self.blobs.set(s, bytes);
        return { data: { sha: s } };
      },
      async createTree(body: { base_tree: string; tree: { path: string; mode: string; sha: string | null }[] }) {
        self.log('createTree', body);
        const t: Tree = new Map(self.trees.get(body.base_tree));
        for (const e of body.tree) {
          if (e.sha === null) t.delete(e.path);
          else t.set(e.path, { sha: e.sha, mode: e.mode });
        }
        const s = sha1(JSON.stringify([...t]) + Math.random());
        self.trees.set(s, t);
        return { data: { sha: s } };
      },
      async createCommit(body: { message: string; tree: string; parents: string[] }) {
        self.log('createCommit', body);
        const s = sha1(JSON.stringify(body));
        self.commits.set(s, { tree: body.tree, parents: body.parents, message: body.message });
        return { data: { sha: s } };
      },
      async createRef(body: { ref: string; sha: string }) {
        self.log('createRef', body);
        self.refs.set(body.ref.replace(/^refs\/heads\//, ''), body.sha);
        return { data: {} };
      },
      async updateRef(body: { ref: string; sha: string; force: boolean }) {
        self.log('updateRef', body);
        if (body.force) throw new Error('force push attempted');
        self.refs.set(body.ref.replace(/^heads\//, ''), body.sha);
        return { data: {} };
      },
    };
    const repos = {
      async getContent({ path, ref }: { path: string; ref: string }) {
        const c = self.commits.get(ref)!;
        const e = self.trees.get(c.tree)!.get(path);
        if (!e) throw notFound();
        return {
          data: { type: 'file', sha: e.sha, encoding: 'base64', content: Buffer.from(self.blobs.get(e.sha)!).toString('base64') },
        };
      },
    };
    const pulls = {
      async create(body: { head: string; base: string; title: string; body: string }) {
        self.log('pulls.create', body);
        self.pulls.push(body);
        return {
          data: {
            number: self.pulls.length,
            title: body.title,
            html_url: `https://github.com/o/r/pull/${self.pulls.length}`,
            head: { ref: body.head },
            state: 'open',
            draft: false,
          },
        };
      },
    };
    return { git, repos, pulls } as unknown as GitHub;
  }
}
