const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(process.cwd(), 'src', 'data', 'agriculture-base-data.json');
const FACTS_PATH = path.join(process.cwd(), 'src', 'data', 'agriculture-base-facts.json');
let cachedData = null;
let cachedFacts = null;

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/leaf\s+hopper/g, 'leafhopper')
    .replace(/green\s+leaf\s+hopper/g, 'greenleafhopper')
    .replace(/([a-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9%+.<>=\s/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compact(value) {
  return normalize(value).replace(/\s+/g, '');
}

function singularize(token) {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith('es')) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1);
  return token;
}

const STOPWORDS = new Set([
  'what', 'which', 'who', 'whom', 'whose', 'why', 'how', 'much', 'many', 'is', 'are', 'was', 'were',
  'the', 'a', 'an', 'of', 'and', 'or', 'in', 'on', 'for', 'to', 'with', 'about', 'from', 'by', 'as',
  'give', 'tell', 'me', 'show', 'find', 'search', 'explain', 'define', 'detail', 'details', 'data',
  'fact', 'facts', 'information', 'info', 'agriculture', 'base', 'please', 'pls', 'meaning', 'means'
]);

function rawTokens(value) {
  return normalize(value)
    .split(' ')
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token))
    .map(singularize);
}

const ATTRIBUTE_DEFS = [
  { key: 'particle size', label: 'particle size', terms: ['particle size', 'particle diameter', 'diameter', 'diameter mm', 'range in diameter', 'size', 'soil separates size', 'soil separate size'] },
  { key: 'order', label: 'order', terms: ['order', 'taxonomic order', 'belongs to order'] },
  { key: 'family', label: 'family', terms: ['family', 'belongs to family'] },
  { key: 'life cycle', label: 'life cycle', terms: ['life cycle', 'lifecycle', 'life history'] },
  { key: 'vector', label: 'vector', terms: ['vector', 'transmitted by', 'transmits', 'transmission'] },
  { key: 'host', label: 'host', terms: ['host', 'host plant'] },
  { key: 'symptom', label: 'symptoms', terms: ['symptom', 'symptoms', 'sign', 'signs'] },
  { key: 'control', label: 'control', terms: ['control', 'management', 'remedy', 'manage'] },
  { key: 'causal organism', label: 'causal organism', terms: ['causal organism', 'pathogen', 'caused by', 'cause'] },
  { key: 'damaging stage', label: 'damaging stage', terms: ['damaging stage', 'damage stage'] },
  { key: 'antenna', label: 'antenna type', terms: ['antenna', 'antennae', 'type of antennae', 'type of antenna'] },
  { key: 'mouth part', label: 'mouth parts', terms: ['mouth part', 'mouth parts'] },
  { key: 'scientific name', label: 'scientific name', terms: ['scientific name', 'sci name', 'zoological name'] },
  { key: 'botanical name', label: 'botanical name', terms: ['botanical name', 'b n', 'bn'] },
  { key: 'common name', label: 'common name', terms: ['common name'] },
  { key: 'protein content', label: 'protein content', terms: ['protein content', 'protein percentage', 'protein percent', 'protein %', 'protein'] },
  { key: 'oil content', label: 'oil content', terms: ['oil content', 'oil percentage', 'oil percent', 'oil %', 'oil'] },
  { key: 'fat content', label: 'fat content', terms: ['fat content', 'fat percentage', 'fat percent', 'fat %', 'fat'] },
  { key: 'origin', label: 'origin', terms: ['origin', 'origin place', 'centre of origin', 'center of origin'] },
  { key: 'chromosome number', label: 'chromosome number', terms: ['chromosome number', 'chromosome no', 'chromosome'] },
  { key: 'inflorescence', label: 'inflorescence', terms: ['inflorescence'] },
  { key: 'fruit type', label: 'fruit type', terms: ['fruit type'] },
  { key: 'seed rate', label: 'seed rate', terms: ['seed rate'] },
  { key: 'spacing', label: 'spacing', terms: ['spacing'] },
  { key: 'ph', label: 'pH', terms: ['ph', 'p h', 'soil ph'] },
  { key: 'temperature', label: 'temperature', terms: ['temperature', 'temp'] },
  { key: 'rainfall', label: 'rainfall', terms: ['rainfall'] },
  { key: 'water requirement', label: 'water requirement', terms: ['water requirement'] },
  { key: 'gestation period', label: 'gestation period', terms: ['gestation period', 'gestation'] },
  { key: 'estrous cycle', label: 'estrous cycle', terms: ['estrous cycle', 'oestrous cycle', 'estrus cycle'] },
  { key: 'heat period', label: 'heat period', terms: ['heat period'] },
  { key: 'puberty age', label: 'puberty age', terms: ['puberty age'] },
  { key: 'lactation period', label: 'lactation period', terms: ['lactation period'] },
  { key: 'dry period', label: 'dry period', terms: ['dry period'] },
  { key: 'trade name', label: 'trade name', terms: ['trade name'] },
  { key: 'dose', label: 'dose', terms: ['dose'] },
  { key: 'premium', label: 'premium', terms: ['premium', 'premium rate'] },
  { key: 'launched', label: 'launched', terms: ['launched', 'launch date', 'started'] },
  { key: 'father', label: 'father', terms: ['father', 'founder'] },
  { key: 'headquarter', label: 'headquarter', terms: ['headquarter', 'headquarters', 'hq'] },
  { key: 'establishment year', label: 'establishment year', terms: ['establishment year', 'established'] }
];

function phraseInText(text, phrase) {
  const n = normalize(text);
  const p = normalize(phrase);
  if (!p) return false;
  if (n === p) return true;
  if (n.includes(p)) return true;
  return compact(n).includes(compact(p));
}

function wordContains(text, word) {
  const n = normalize(text);
  const w = normalize(word);
  if (!w) return false;
  return new RegExp(`(^|\\s)${w.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}($|\\s)`).test(n);
}

function termMatchesText(text, term) {
  const t = normalize(term);
  if (!t) return false;
  if (t.includes(' ')) return phraseInText(text, t);
  return wordContains(text, t);
}

function detectAttributes(query) {
  const q = normalize(query);
  return ATTRIBUTE_DEFS.filter((def) => def.terms.some((term) => phraseInText(q, term)));
}

function attributeTokenSet(attributes) {
  const out = new Set();
  attributes.forEach((attr) => {
    [attr.key, attr.label, ...attr.terms].forEach((term) => rawTokens(term).forEach((token) => out.add(token)));
  });
  return out;
}

function queryParts(query) {
  const attributes = detectAttributes(query);
  const allTokens = rawTokens(query);
  const attrTokens = attributeTokenSet(attributes);
  const coreTokens = allTokens.filter((token) => !attrTokens.has(token));
  return {
    query,
    normalized: normalize(query),
    attributes,
    attrTokens,
    allTokens,
    coreTokens: coreTokens.length ? coreTokens : allTokens.filter((token) => !attrTokens.has(token))
  };
}

function matchesTerm(text, token) {
  const n = normalize(text);
  const c = compact(n);
  const t = normalize(token);
  const tc = compact(t);
  if (!t) return false;
  if (n.split(' ').includes(t)) return true;
  if (n.includes(t)) return true;
  if (tc && c.includes(tc)) return true;
  return false;
}

function allTokensHit(text, tokens) {
  return tokens.length > 0 && tokens.every((token) => matchesTerm(text, token));
}

function anyTokenHit(text, tokens) {
  return tokens.length > 0 && tokens.some((token) => matchesTerm(text, token));
}

function cleanLine(line) {
  return String(line || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+—\s+/g, ' — ')
    .replace(/^[•\-\d.)\s]+/, '')
    .trim();
}

function isNoisyLine(line) {
  const n = normalize(line);
  if (!n || n.length < 3) return true;
  if (/^table of contents/.test(n)) return true;
  if (/^document title$/.test(n)) return true;
  if (/^no table of contents/.test(n)) return true;
  if (/^page no$/.test(n)) return true;
  return false;
}

function blockLines(block) {
  if (!block) return [];
  if (block.type === 'paragraph' && block.text) return [block.text];
  if (block.type === 'list') return (block.items || []).filter(Boolean);
  if (block.type === 'table') return (block.rows || []).map((row) => row.filter(Boolean).join(' — ')).filter(Boolean);
  return [];
}

function conceptLines(concept) {
  if (concept._lines) return concept._lines;
  const lines = [];
  (concept.blocks || []).forEach((block) => blockLines(block).forEach((line) => lines.push(line)));
  concept._lines = lines;
  return lines;
}

function conceptPlainText(concept) {
  if (concept._plain) return concept._plain;
  const parts = [concept.subject, concept.title, ...(concept.aliases || []), ...(concept.keywords || []), ...conceptLines(concept)];
  concept._plain = parts.filter(Boolean).join('\n');
  return concept._plain;
}

function prepareConcept(concept) {
  concept._norm = normalize(conceptPlainText(concept));
  concept._titleNorm = normalize(concept.title);
  concept._keywordNorm = normalize([...(concept.aliases || []), ...(concept.keywords || [])].join(' '));
  return concept;
}

function loadData() {
  if (cachedData) return cachedData;
  const raw = fs.readFileSync(DATA_PATH, 'utf8');
  const payload = JSON.parse(raw);
  const concepts = Array.isArray(payload.concepts) ? payload.concepts : [];
  concepts.forEach(prepareConcept);
  cachedData = { meta: payload.meta || {}, concepts };
  return cachedData;
}

function prepareFact(fact) {
  const prepared = { ...fact };
  prepared._entityNorm = normalize(prepared.entity);
  prepared._attributeNorm = normalize(prepared.attribute);
  prepared._valueNorm = normalize(prepared.value);
  prepared._conceptNorm = normalize(prepared.concept || '');
  prepared._subjectNorm = normalize(prepared.subject || '');
  prepared._norm = normalize([prepared.entity, prepared.attribute, prepared.value, prepared.concept, prepared.subject].filter(Boolean).join(' '));
  return prepared;
}

function loadFacts() {
  if (cachedFacts) return cachedFacts;
  try {
    const raw = fs.readFileSync(FACTS_PATH, 'utf8');
    const payload = JSON.parse(raw);
    cachedFacts = (Array.isArray(payload.facts) ? payload.facts : []).map(prepareFact);
  } catch (error) {
    cachedFacts = [];
  }
  return cachedFacts;
}

function attributeMatches(fact, attributes) {
  if (!attributes.length) return { ok: true, score: 0 };
  let best = 0;
  const searchable = [fact.attribute, fact.concept].filter(Boolean).join(' ');
  for (const attr of attributes) {
    let score = 0;
    if (phraseInText(fact.attribute, attr.key)) score += 180;
    if (phraseInText(fact.attribute, attr.label)) score += 160;
    attr.terms.forEach((term) => {
      if (termMatchesText(fact.attribute, term)) score += 120;
      else if (termMatchesText(searchable, term)) score += 45;
    });
    // Semantic bridge: users say particle size, tables often say Diameter (mm).
    if (attr.key === 'particle size' && /diameter|size|range/.test(fact._attributeNorm)) score += 220;
    if (attr.key === 'ph' && /^ph$|soil ph|reaction/.test(fact._attributeNorm)) score += 160;
    if (attr.key === 'protein content' && /protein/.test(fact._attributeNorm)) score += 180;
    if (attr.key === 'oil content' && /oil/.test(fact._attributeNorm)) score += 180;
    if (attr.key === 'family' && /family/.test(fact._attributeNorm)) score += 180;
    if (attr.key === 'order' && /^order$|taxonomic order|belongs to order/.test(fact._attributeNorm)) score += 180;
    if (score > best) best = score;
  }
  return { ok: best > 0, score: best };
}

function coreMatchesFact(fact, coreTokens) {
  const primary = [fact.entity, fact.value, fact.concept].filter(Boolean).join(' ');
  const entityValue = [fact.entity, fact.value].filter(Boolean).join(' ');
  return {
    anyPrimary: anyTokenHit(primary, coreTokens),
    allPrimary: allTokensHit(primary, coreTokens),
    allEntityValue: allTokensHit(entityValue, coreTokens),
    entityHits: coreTokens.filter((token) => matchesTerm(fact.entity, token)).length,
    valueHits: coreTokens.filter((token) => matchesTerm(fact.value, token)).length,
    conceptHits: coreTokens.filter((token) => matchesTerm(fact.concept, token)).length,
    attributeHits: coreTokens.filter((token) => matchesTerm(fact.attribute, token)).length
  };
}

function isGenericEntity(entity) {
  const n = normalize(entity);
  if (!n) return true;
  if (/^\d+\.?$/.test(n)) return true;
  if (/^s\.?\s*no\.?$/.test(n)) return true;
  if (['details', 'crop', 'crops', 'type', 'types', 'property', 'important points', 'miscellaneous'].includes(n)) return true;
  return false;
}

function scoreFact(fact, parts) {
  const coreTokens = parts.coreTokens;
  if (!coreTokens.length) return 0;
  const core = coreMatchesFact(fact, coreTokens);

  // Important: never let an entity query match only a bad table header/attribute.
  if (!core.anyPrimary) return 0;

  const attr = attributeMatches(fact, parts.attributes);
  if (parts.attributes.length && !attr.ok) return 0;

  let score = 0;
  if (core.allEntityValue) score += 280;
  else if (core.allPrimary) score += 200;
  score += core.entityHits * 120;
  score += core.valueHits * 90;
  score += core.conceptHits * 45;
  score += attr.score;

  if (parts.attributes.length) {
    // Direct fact questions should prefer entity + attribute table rows.
    if (core.entityHits > 0) score += 160;
    if (core.valueHits > 0 && core.entityHits === 0) score += 60;
    if (isGenericEntity(fact.entity)) score -= 80;
  } else {
    // Broad keyword questions should prefer entity/value occurrences over attribute-only noise.
    if (core.entityHits > 0 || core.valueHits > 0) score += 90;
    if (core.attributeHits > 0 && core.entityHits === 0 && core.valueHits === 0) score -= 180;
  }

  const value = String(fact.value || '');
  if (/^[<>]?[\d.]+\s*(mm|cm|m|%|kg|g|q|days?|hours?|ppm|ha|lit|ml)/i.test(value)) score += 55;
  if (String(fact.attribute || '').length <= 32) score += 20;
  if (String(fact.value || '').length <= 100) score += 15;
  return Math.max(0, score);
}

function searchFacts(query, limit = 20) {
  const parts = queryParts(query);
  return loadFacts()
    .map((fact) => ({ fact, score: scoreFact(fact, parts) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function lineAttributeMatches(line, concept, attributes) {
  if (!attributes.length) return { ok: true, score: 0 };
  const search = [line, concept.title].join(' ');
  let best = 0;
  for (const attr of attributes) {
    let score = 0;
    attr.terms.forEach((term) => { if (termMatchesText(search, term)) score += 80; });
    if (attr.key === 'particle size' && /diameter|particle size|size|soil separates/.test(normalize(search))) score += 110;
    if (attr.key === 'order' && wordContains(search, 'order')) score += 90;
    if (attr.key === 'family' && wordContains(search, 'family')) score += 90;
    if (score > best) best = score;
  }
  return { ok: best > 0, score: best };
}

function scoreLine(concept, line, parts) {
  const cleaned = cleanLine(line);
  if (isNoisyLine(cleaned)) return 0;
  const primary = [cleaned, concept.title].join(' ');
  if (!anyTokenHit(primary, parts.coreTokens)) return 0;
  const attr = lineAttributeMatches(cleaned, concept, parts.attributes);
  if (parts.attributes.length && !attr.ok) return 0;
  let score = 0;
  if (allTokensHit(primary, parts.coreTokens)) score += 120;
  parts.coreTokens.forEach((token) => {
    if (matchesTerm(cleaned, token)) score += 55;
    if (matchesTerm(concept.title, token)) score += 35;
  });
  score += attr.score;
  score += Math.min(25, Math.max(0, 180 - cleaned.length) / 8);
  return score;
}

function searchLines(query, limit = 14) {
  const parts = queryParts(query);
  const rows = [];
  loadData().concepts.forEach((concept) => {
    conceptLines(concept).forEach((line) => {
      const score = scoreLine(concept, line, parts);
      if (score > 0) rows.push({ line: cleanLine(line), concept, score });
    });
  });
  return rows.sort((a, b) => b.score - a.score).slice(0, limit);
}

function sentenceWithPeriod(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function displayEntity(entity) {
  return String(entity || '').replace(/\s+/g, ' ').trim();
}

function displayValue(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanAttributeLabel(attribute, parts) {
  const attr = parts.attributes[0];
  if (attr) return attr.label;
  const raw = String(attribute || '').trim();
  if (!raw) return '';
  if (/^diameter/i.test(raw)) return 'particle size';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function factToSentence(fact, query) {
  const parts = queryParts(query);
  const entity = displayEntity(fact.entity);
  const value = displayValue(fact.value);
  const attr = cleanAttributeLabel(fact.attribute, parts);
  if (!value) return '';

  if (parts.attributes.length && entity && attr) {
    return sentenceWithPeriod(`${entity} ${attr}: ${value}`);
  }
  if (entity && attr) return sentenceWithPeriod(`${entity}: ${attr} — ${value}`);
  if (entity) return sentenceWithPeriod(`${entity}: ${value}`);
  return sentenceWithPeriod(value);
}

function dedupeSentences(lines, limit = 8) {
  const output = [];
  const seen = new Set();
  lines.forEach((line) => {
    const clean = cleanLine(line).replace(/\s*\.\s*$/, '');
    if (!clean || isNoisyLine(clean)) return;
    const key = compact(clean).slice(0, 160);
    if (seen.has(key)) return;
    seen.add(key);
    output.push(clean.length > 320 ? `${clean.slice(0, 317)}...` : clean);
  });
  return output.slice(0, limit).map(sentenceWithPeriod);
}

function unavailableAnswer(query) {
  const parts = queryParts(query);
  const core = parts.coreTokens.join(' ').trim();
  const attr = parts.attributes[0]?.label;
  if (attr && core) return `The ${attr} of ${core} is not available in Agriculture Base yet.`;
  if (attr) return `This exact fact is not available in Agriculture Base yet.`;
  return `This keyword is not available in Agriculture Base yet.`;
}

function makeDirectFactAnswer(query, factItems, lineItems) {
  const strongFacts = factItems.filter((item) => item.score >= 300);
  if (strongFacts.length) {
    const bestScore = strongFacts[0].score;
    const useful = strongFacts
      .filter((item, index) => index === 0 || (!isGenericEntity(item.fact.entity) && item.score >= bestScore - 35))
      .slice(0, 6);
    const sentences = dedupeSentences(useful.map((item) => factToSentence(item.fact, query)), 6);
    return { ok: true, mode: 'atomic-fact', query, answer: sentences[0], bullets: sentences.slice(1) };
  }
  const strongLines = lineItems.filter((item) => item.score >= 210);
  if (strongLines.length) {
    const sentences = dedupeSentences(strongLines.map((item) => item.line), 5);
    return { ok: true, mode: 'atomic-line', query, answer: sentences[0], bullets: sentences.slice(1) };
  }
  return { ok: true, mode: 'missing', query, answer: unavailableAnswer(query), bullets: [] };
}

function makeBroadKeywordAnswer(query, factItems, lineItems) {
  const parts = queryParts(query);
  const usefulFacts = factItems.filter((item) => item.score >= 160);

  // If a keyword appears as a vector in many rows, produce an actual answer instead of random rows.
  const vectorRows = usefulFacts
    .map((item) => item.fact)
    .filter((fact) => /vector/.test(fact._attributeNorm) && anyTokenHit(fact.value, parts.coreTokens));
  if (vectorRows.length >= 2) {
    const rows = dedupeSentences(vectorRows.map((fact) => `${displayEntity(fact.entity)}: ${displayValue(fact.value)}`), 7);
    return {
      ok: true,
      mode: 'keyword-vector',
      query,
      answer: `${displayEntity(parts.coreTokens.join(' ')).replace(/^./, (ch) => ch.toUpperCase())} is mentioned as a vector in Agriculture Base.`,
      bullets: rows
    };
  }

  const factSentences = usefulFacts.map((item) => factToSentence(item.fact, query));
  const lineSentences = lineItems.filter((item) => item.score >= 100).map((item) => item.line);
  const combined = dedupeSentences([...factSentences, ...lineSentences], 8);
  if (!combined.length) return { ok: true, mode: 'missing', query, answer: unavailableAnswer(query), bullets: [] };
  return { ok: true, mode: 'keyword', query, answer: combined[0], bullets: combined.slice(1) };
}



const ALLOWED_SHORT_QUERIES = new Set(['ph', 'ec', 'sar', 'esp', 'npk', 'c n', 'c:n', 'c3', 'c4']);
const SHORT_QUERY_HELP = 'Please type a clearer agriculture term, for example: Fabaceae, Poaceae, monocot characters, or particle size of sand.';

function isTooShortOrUnclear(query) {
  const n = normalize(query);
  if (!n) return true;
  if (ALLOWED_SHORT_QUERIES.has(n)) return false;
  const tokens = rawTokens(query);
  if (!tokens.length) return true;
  if (n.length < 4) return true;
  if (tokens.length === 1 && tokens[0].length < 4) return true;
  return false;
}

function clearQueryAnswer(query) {
  return { ok: true, mode: 'unclear-query', query, answer: SHORT_QUERY_HELP, bullets: [] };
}

const FAMILY_PROFILES = [
  {
    key: 'poaceae',
    aliases: ['poaceae', 'gramineae', 'grass family'],
    label: 'Poaceae',
    synonymLine: 'Poaceae is also known as Gramineae or the grass family.',
    memberNeedles: ['poaceae', 'gramineae'],
    defaultMembers: ['Rice', 'Wheat', 'Barley', 'Maize', 'Sorghum', 'Pearl millet', 'Finger millet', 'Oat', 'Sugarcane'],
    characters: ['General characters: mostly monocot plants, fibrous root system and parallel venation.', 'Important crop group: cereals and grasses.']
  },
  {
    key: 'fabaceae',
    aliases: ['fabaceae', 'leguminosae', 'legume family', 'papilionaceae'],
    label: 'Fabaceae',
    synonymLine: 'Fabaceae is also known as Leguminosae or the legume family.',
    memberNeedles: ['fabaceae', 'leguminosae'],
    defaultMembers: ['Chickpea', 'Pigeon pea', 'Green gram', 'Black gram', 'Lentil', 'Pea', 'Cowpea', 'Soybean', 'Groundnut', 'Berseem', 'Alfalfa'],
    characters: ['General characters: mostly legumes/pulses with pod-type fruits and nitrogen-fixing association.', 'Important crop group: pulses, oilseed legumes and fodder legumes.']
  }
];

function queryHasOnlyFamilyIntent(parts, profile) {
  const allowed = new Set(['family', 'families', 'member', 'members', 'example', 'examples', 'crop', 'crops', 'character', 'characters', 'general', 'list', 'what']);
  const aliasTokens = new Set(profile.aliases.flatMap((alias) => rawTokens(alias)));
  const meaningful = parts.allTokens.filter((token) => !allowed.has(token));
  return meaningful.length > 0 && meaningful.every((token) => aliasTokens.has(token));
}

function familyProfileForQuery(parts) {
  if (parts.attributes.length) return null;
  return FAMILY_PROFILES.find((profile) => queryHasOnlyFamilyIntent(parts, profile)) || null;
}

function uniqueCleanList(values, limit = 16) {
  const out = [];
  const seen = new Set();
  values.forEach((value) => {
    const clean = String(value || '').replace(/\s+/g, ' ').trim();
    if (!clean || clean.length > 40) return;
    if (/^\d+\.?$/.test(clean)) return;
    if (/vernacular|botanical name|family|crop$/i.test(clean)) return;
    const key = compact(clean);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  });
  return out.slice(0, limit);
}

function familyMembers(profile) {
  const facts = loadFacts();
  const members = facts
    .filter((fact) => /family/.test(fact._attributeNorm) && profile.memberNeedles.some((needle) => fact._valueNorm.includes(needle)))
    .map((fact) => fact.entity);
  const merged = uniqueCleanList([...members, ...profile.defaultMembers], 14);
  return merged.length ? merged : profile.defaultMembers;
}

function makeFamilyAnswer(parts, profile) {
  const members = familyMembers(profile);
  const bullets = [
    `Important members: ${members.join(', ')}.`,
    ...profile.characters
  ];
  return { ok: true, mode: 'family-profile', query: parts.query, answer: profile.synonymLine, bullets };
}

function isMonocotQuery(parts) {
  if (parts.attributes.length) return false;
  const n = parts.normalized;
  return /\b(monocot|monocots|monocotyledon|monocotyledonous)\b/.test(n);
}

function makeMonocotAnswer(query) {
  return {
    ok: true,
    mode: 'monocot-profile',
    query,
    answer: 'Monocots are plants whose embryo has one cotyledon.',
    bullets: [
      'Main characters: one cotyledon, fibrous root system and parallel venation.',
      'Examples: wheat, bajra, maize, rice, garlic, onion and grasses.'
    ]
  };
}

function cleanSystemName(title) {
  const n = normalize(title);
  if (n.includes('usda')) return 'USDA system';
  if (n.includes('isss')) return 'ISSS system';
  return String(title || 'Classification system').replace(/\s+/g, ' ').trim();
}

function soilSeparateRowsFor(term) {
  const data = loadData();
  const rowsBySystem = [];
  data.concepts.forEach((concept) => {
    const title = normalize(concept.title);
    if (!(title.includes('usda') || title.includes('isss'))) return;
    const tableRows = [];
    (concept.blocks || []).forEach((block) => {
      if (block.type !== 'table') return;
      (block.rows || []).forEach((row) => {
        if (!Array.isArray(row) || row.length < 2) return;
        const label = String(row[0] || '').replace(/\s+/g, ' ').trim();
        const value = String(row[1] || '').replace(/\s+/g, ' ').trim();
        if (!label || !value || /soil separates/i.test(label)) return;
        const labelNorm = normalize(label);
        if (term === 'sand') {
          if (/sand/.test(labelNorm)) tableRows.push({ label, value });
        } else if (labelNorm === term) {
          tableRows.push({ label, value });
        }
      });
    });
    if (tableRows.length) rowsBySystem.push({ system: cleanSystemName(concept.title), rows: tableRows });
  });
  return rowsBySystem;
}

function detectedSoilSeparate(parts) {
  const n = parts.normalized;
  if (/\bsand\b|\bsandy\b/.test(n)) return 'sand';
  if (/\bsilt\b/.test(n)) return 'silt';
  if (/\bclay\b/.test(n)) return 'clay';
  return '';
}

function makeSoilParticleAnswer(parts) {
  const wantsParticleSize = parts.attributes.some((attr) => attr.key === 'particle size') || /particle size|diameter|soil separate/.test(parts.normalized);
  if (!wantsParticleSize) return null;
  const term = detectedSoilSeparate(parts);
  if (!term) return null;
  const grouped = soilSeparateRowsFor(term);
  if (!grouped.length) return null;
  const nice = term.charAt(0).toUpperCase() + term.slice(1);
  const bullets = grouped.map((group) => {
    const values = group.rows.map((row) => `${row.label}: ${row.value}${/mm/i.test(row.value) ? '' : ' mm'}`).join('; ');
    return `${group.system}: ${values}.`;
  });
  return {
    ok: true,
    mode: 'soil-particle-size',
    query: parts.query,
    answer: `${nice} particle size differs according to the classification system.`,
    bullets
  };
}

function makeAnswer(query) {
  const parts = queryParts(query);
  if (isTooShortOrUnclear(query)) return clearQueryAnswer(query);
  const particleAnswer = makeSoilParticleAnswer(parts);
  if (particleAnswer) return particleAnswer;
  const familyProfile = familyProfileForQuery(parts);
  if (familyProfile) return makeFamilyAnswer(parts, familyProfile);
  if (isMonocotQuery(parts)) return makeMonocotAnswer(query);
  const factItems = searchFacts(query, 28);
  const lineItems = searchLines(query, 18);
  if (parts.attributes.length) return makeDirectFactAnswer(query, factItems, lineItems);
  return makeBroadKeywordAnswer(query, factItems, lineItems);
}

module.exports = async function agricultureAnswer(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return send(res, 200, { ok: true });
  }
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const query = String(body.query || '').trim().slice(0, 180);
    if (normalize(query).length < 2) return send(res, 200, { ok: true, empty: true });
    const answer = makeAnswer(query);
    return send(res, 200, answer);
  } catch (error) {
    console.error('[Agriculture Base Answer API]', error);
    return send(res, 500, { ok: false, error: 'Agriculture Base answer failed' });
  }
};
