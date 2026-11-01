import { Directory, File, Paths } from 'expo-file-system';
import type { FileStore } from './types';

/**
 * Files live in the app's private document sandbox (excluded from backups via
 * android:allowBackup=false; iOS app sandbox). Everything written here is ciphertext.
 */
export function createFileStore(rootName = 'halcyx-cache'): FileStore {
  const root = new Directory(Paths.document, rootName);
  if (!root.exists) root.create({ intermediates: true });

  const fileAt = (path: string) => new File(root, ...path.split('/'));

  const walk = (dir: Directory, prefix: string): string[] =>
    dir.list().flatMap((entry) => (entry instanceof Directory ? walk(entry, `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`]));

  return {
    async write(path, bytes) {
      const file = fileAt(path);
      const parent = file.parentDirectory;
      if (!parent.exists) parent.create({ intermediates: true });
      if (!file.exists) file.create();
      file.write(bytes);
    },
    async read(path) {
      return fileAt(path).bytes();
    },
    async exists(path) {
      return fileAt(path).exists;
    },
    async remove(path) {
      const file = fileAt(path);
      if (file.exists) file.delete();
    },
    async removeDir(path) {
      const dir = new Directory(root, ...path.split('/'));
      if (dir.exists) dir.delete();
    },
    async list(dir) {
      const d = dir ? new Directory(root, ...dir.split('/')) : root;
      if (!d.exists) return [];
      return walk(d, dir ? `${dir}/` : '');
    },
    async size(path) {
      const file = fileAt(path);
      return file.exists ? (file.size ?? 0) : 0;
    },
  };
}
