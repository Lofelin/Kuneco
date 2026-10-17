const managedTag = /^kuneco-(worker|gateway):[a-f0-9]{20}$/;
const imageId = /^sha256:[a-f0-9]{64}$/;

// Conservative cleanup: even stopped/rollback containers and extra tags retain an image.
export function planImageCleanup(images, containers) {
 const referenced = new Set(containers.map(item => item.Image));
 const managed = images.filter(item => item.RepoTags?.some(tag => managedTag.test(tag)));
 const retained = new Set();
 for (const kind of ['worker', 'gateway']) {
  const ordered = managed.filter(item => item.RepoTags.some(tag => tag.startsWith(`kuneco-${kind}:`) && managedTag.test(tag)))
   .sort((a,b) => Date.parse(b.Created)-Date.parse(a.Created) || a.Id.localeCompare(b.Id));
  for (const item of ordered.slice(0,2)) retained.add(item.Id);
 }
 const entries = managed.map(item => {
  const reason = !imageId.test(item.Id) || !Number.isFinite(Date.parse(item.Created)) ? 'invalid-metadata'
   : referenced.has(item.Id) ? 'container-reference'
   : item.RepoTags.length !== 1 || (item.RepoDigests ?? []).some(digest => !new RegExp(`^${item.RepoTags[0].split(':')[0]}@sha256:[a-f0-9]{64}$`).test(digest)) ? 'shared-reference'
   : retained.has(item.Id) ? 'recent-version' : null;
  return { id:item.Id, tag:item.RepoTags[0], sizeBytes:item.Size, created:item.Created, reason };
 });
 return { candidates:entries.filter(item => !item.reason), retained:entries.filter(item => item.reason),
  note:'Image sizes include shared layers; their sum is not reclaimable disk space. Volumes and build cache are untouched.' };
}

export async function inspectImageCleanup(command) {
 const daemonId = (await command(['info','--format','{{.ID}}'])).trim();
 if (!daemonId) throw new Error('Docker daemon identity is unavailable');
 const ids = [...new Set((await command(['image','ls','-aq','--no-trunc'])).trim().split(/\s+/).filter(Boolean))];
 const images = [];
 for (const id of ids) images.push(...JSON.parse(await command(['image','inspect',id])));
 const containerIds = (await command(['ps','-aq','--no-trunc'])).trim().split(/\s+/).filter(Boolean);
 const containers = [];
 for (const id of containerIds) containers.push(...JSON.parse(await command(['container','inspect',id])));
 return { version:1, daemonId, ...planImageCleanup(images,containers) };
}

export async function applyImageCleanup(command, preview) {
 if (preview?.version !== 1 || !preview.daemonId || !Array.isArray(preview.candidates)) throw new Error('Invalid cleanup preview');
 const removed = [], skipped = [];
 for (const candidate of preview.candidates) {
  if (!imageId.test(candidate.id) || !managedTag.test(candidate.tag)) throw new Error('Invalid cleanup candidate');
  // Re-read every time: newly attached containers, tags and newer images can change eligibility.
  const current = await inspectImageCleanup(command);
  if (current.daemonId !== preview.daemonId) throw new Error('Docker daemon changed since preview');
  if (!current.candidates.some(item => item.id === candidate.id && item.tag === candidate.tag)) {
   skipped.push(candidate); continue;
  }
  // By immutable ID, without force. Docker itself refuses concurrent container/multi-tag references.
  await command(['image','rm',candidate.id]);
  removed.push(candidate);
 }
 return {removed,skipped};
}
