import { createHash } from 'node:crypto';

export interface FetchRefspecRecord {
  remote: string;
  refspec: string;
}

export interface TrackingProducerAnalysis {
  localRef: string;
  producers: { remote: string; sourceRef: string; refspec: string }[];
  negativeOrAmbiguous: boolean;
  namespaceAllowed: boolean;
}

interface ParsedRefspec {
  negative: boolean;
  source: string;
  destination?: string;
  valid: boolean;
}

function canonical(spec: string): string {
  return spec.trim().startsWith('+') ? spec.trim().slice(1) : spec.trim();
}

function parseRefspec(spec: string): ParsedRefspec {
  const value = canonical(spec);
  const negative = value.startsWith('^');
  const body = negative ? value.slice(1) : value;
  const split = body.indexOf(':');
  const source = split < 0 ? body : body.slice(0, split);
  const destination = split < 0 ? undefined : body.slice(split + 1);
  const sourceStars = [...source].filter((char) => char === '*').length;
  const destinationStars = destination ? [...destination].filter((char) => char === '*').length : 0;
  return {
    negative,
    source,
    destination,
    valid: source.length > 0 && sourceStars <= 1 && (negative
      ? destination === undefined
      : destination !== undefined && destination.length > 0 && sourceStars === destinationStars),
  };
}

function capture(pattern: string, value: string): string | null {
  const star = pattern.indexOf('*');
  if (star < 0) return pattern === value ? '' : null;
  const before = pattern.slice(0, star);
  const after = pattern.slice(star + 1);
  if (!value.startsWith(before) || !value.endsWith(after)) return null;
  return value.slice(before.length, value.length - after.length);
}

function mapSource(parsed: ParsedRefspec, sourceRef: string): string | null {
  if (!parsed.valid || parsed.negative || !parsed.destination) return null;
  const captured = capture(parsed.source, sourceRef);
  if (captured === null) return null;
  return parsed.destination.includes('*') ? parsed.destination.replace('*', captured) : parsed.destination;
}

function invertDestination(parsed: ParsedRefspec, localRef: string): string | null {
  if (!parsed.valid || parsed.negative || !parsed.destination) return null;
  const captured = capture(parsed.destination, localRef);
  if (captured === null) return null;
  return parsed.source.includes('*') ? parsed.source.replace('*', captured) : parsed.source;
}

export function parseFetchRefspecConfig(raw: string): FetchRefspecRecord[] {
  const tokens = raw.split('\0').filter(Boolean);
  const records: FetchRefspecRecord[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    const separator = token.indexOf('\n');
    const key = separator >= 0 ? token.slice(0, separator) : token;
    const value = separator >= 0 ? token.slice(separator + 1) : (tokens[index + 1] ?? '');
    if (separator < 0 && value) index += 1;
    const match = /^remote\.(.+)\.fetch$/.exec(key);
    if (match?.[1] && value) records.push({ remote: match[1], refspec: value });
  }
  return records;
}

export function canonicalRefspecDigest(records: FetchRefspecRecord[]): string {
  const sorted = records.map((record) => `${record.remote}\0${record.refspec}`).sort().join('\n');
  return createHash('sha256').update(sorted).digest('hex');
}

export function analyzeTrackingRefs(
  records: FetchRefspecRecord[],
  targets: { remote: string; branch: string }[],
): TrackingProducerAnalysis[] {
  const parsed = records.map((record) => ({ record, parsed: parseRefspec(record.refspec) }));
  const localRefs = new Set<string>();
  for (const target of targets) {
    const sourceRef = `refs/heads/${target.branch}`;
    for (const entry of parsed.filter((item) => item.record.remote === target.remote)) {
      const localRef = mapSource(entry.parsed, sourceRef);
      if (localRef) localRefs.add(localRef);
    }
  }

  return [...localRefs].sort().map((localRef) => {
    const producers = parsed.flatMap(({ record, parsed: spec }) => {
      const sourceRef = invertDestination(spec, localRef);
      return sourceRef ? [{ remote: record.remote, sourceRef, refspec: record.refspec }] : [];
    });
    const unique = new Map(producers.map((producer) => [
      `${producer.remote}\0${producer.sourceRef}\0${producer.refspec}`,
      producer,
    ]));
    const canonicalProducers = [...unique.values()].sort((a, b) =>
      `${a.remote}\0${a.sourceRef}\0${a.refspec}`.localeCompare(`${b.remote}\0${b.sourceRef}\0${b.refspec}`),
    );
    const negativeMatch = canonicalProducers.some((producer) => parsed.some(({ record, parsed: spec }) =>
      record.remote === producer.remote && spec.valid && spec.negative && capture(spec.source, producer.sourceRef) !== null,
    ));
    const malformedForProducer = canonicalProducers.some((producer) => parsed.some(({ record, parsed: spec }) =>
      record.remote === producer.remote && !spec.valid,
    ));
    return {
      localRef,
      producers: canonicalProducers,
      negativeOrAmbiguous: negativeMatch || malformedForProducer || canonicalProducers.length !== 1,
      namespaceAllowed: localRef.startsWith('refs/remotes/'),
    };
  });
}
