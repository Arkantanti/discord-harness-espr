import path from 'node:path';
/** Sanitize a relative page path: no absolute paths, no traversal. Returns null if invalid. */
export function sanitizePagePath(p) {
    if (!p || path.isAbsolute(p))
        return null;
    const norm = path.normalize(p);
    if (norm.startsWith('..') || norm.includes('..' + path.sep))
        return null;
    return norm;
}
//# sourceMappingURL=policy.js.map