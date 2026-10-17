import { readFile, writeFile } from 'node:fs/promises';
const supported = 'AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CO KM CG CD CR CI HR CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GR GD GT GN GW GY HT HN HU IS IN ID IQ IE IL IT JM JP JO KZ KE KI KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ NA NR NP NL NZ NI NE NG MK NO OM PK PW PS PA PG PY PE PH PL PT QA RO RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SO SB ZA KR SS ES LK SD SR SE CH TW TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VA VN ZM ZW'.split(' ');
// Dependencies inherit support under the official policy; CN dependencies do not.
const parents = {AI:'GB',AS:'US',AW:'NL',BM:'GB',BQ:'NL',CC:'AU',CK:'NZ',CW:'NL',CX:'AU',FK:'GB',FO:'DK',GF:'FR',GG:'GB',GI:'GB',GL:'DK',GP:'FR',GS:'GB',GU:'US',IM:'GB',IO:'GB',JE:'GB',KY:'GB',MF:'FR',MP:'US',MQ:'FR',MS:'GB',NC:'FR',NF:'AU',NU:'NZ',PF:'FR',PM:'FR',PN:'GB',PR:'US',RE:'FR',SH:'GB',SJ:'NO',SX:'NL',TC:'GB',TK:'NZ',UM:'US',VG:'GB',VI:'US',WF:'FR',YT:'FR'};
const zones = {};
for (const line of (await readFile('/usr/share/zoneinfo/zone.tab','utf8')).split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const [country, , zone] = line.split('\t'); if (zone) zones[zone] = country.split(',');
}
const zi = await readFile('/usr/share/zoneinfo/tzdata.zi','utf8');
const aliases = Object.fromEntries([...zi.matchAll(/^L\s+(\S+)\s+(\S+)$/gm)].map(match=>[match[2],match[1]]));
// Preserve country-specific aliases (e.g. Africa/Asmera) instead of assigning the
// canonical zone's country to aliases shared for historical clock equivalence.
for(const [zone,countries] of Object.entries(zones)) {
  try { const canonical = new Intl.DateTimeFormat('en',{timeZone:zone}).resolvedOptions().timeZone; if(!zones[canonical]) zones[canonical]=countries; } catch {}
}
const data = {source:'https://www.anthropic.com/supported-countries',reviewedAt:'2026-10-13',tzdb:zi.split('\n')[0],supported:[...new Set(supported)],parents,zones,aliases,deniedZones:['Europe/Simferopol']};
await writeFile('src/data/environment-policy.json',JSON.stringify(data,null,2)+'\n');
