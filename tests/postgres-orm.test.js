const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { Params, compileFilter, compileAggregate, compileUpdate } = require('../src/database/orm/translate.js');
const { buildFields, Mixed } = require('../src/database/orm/schema.js');

const fields = buildFields({
	_id: Number,
	name: String,
	count: { type: Number, default: 0 },
	flag: { type: Boolean, default: false },
	at: Date,
	data: { type: Mixed, default: {} },
});

const filterSql = (filter) => {
	const params = new Params();
	const text = compileFilter(filter, { fields, params });
	return { text, values: params.values };
};

describe('Filter -> SQL', () => {
	test('Gleichheit, null, Vergleiche und $in laufen ueber Parameter', () => {
		assert.deepEqual(filterSql({ name: 'a' }), { text: '"name" = $1::text', values: ['a'] });
		assert.equal(filterSql({ name: null }).text, '"name" IS NULL');
		assert.equal(filterSql({ count: { $gt: 3 } }).text, '"count" > $1::double precision');
		assert.equal(filterSql({ name: { $in: ['a', 'b'] } }).text, '("name" = ANY($1::text[]))');
		assert.equal(filterSql({ name: { $in: [] } }).text, 'FALSE');
		assert.equal(filterSql({}).text, 'TRUE');
	});

	test('Regex, $not, $ne und $or', () => {
		assert.equal(filterSql({ name: /^ab/i }).text, '"name"::text ~* $1');
		assert.equal(filterSql({ name: { $not: /^custom:/ } }).text, '("name" IS NULL OR "name"::text !~ $1)');
		assert.equal(filterSql({ name: { $ne: null } }).text, '"name" IS NOT NULL');
		assert.equal(filterSql({ $or: [{ name: 'a' }, { count: 2 }] }).text, '("name" = $1::text OR "count" = $2::double precision)');
	});

	test('Pfade in JSON-Feldern werden geprueft', () => {
		assert.equal(filterSql({ 'data.administrator': true }).text, '("data"#>\'{administrator}\') = $1::jsonb');
		assert.throws(() => filterSql({ "data.x'; DROP": 1 }), /Ungueltiger Pfad/);
		assert.throws(() => filterSql({ unbekannt: 1 }), /Unbekanntes Feld/);
		assert.throws(() => filterSql({ $where: 'x' }), /nicht unterstuetzt/);
	});
});

describe('Update und Aggregation -> SQL', () => {
	test('$inc, $set, $setOnInsert', () => {
		const params = new Params();
		const { set, insert } = compileUpdate({ $inc: { count: 2 }, $set: { name: 'x' }, $setOnInsert: { flag: true } }, { fields, params });
		assert.equal(set.get('count'), 'COALESCE("count", 0) + $1');
		assert.equal(set.get('name'), '$2::text');
		assert.ok(!set.has('flag'));
		assert.equal(insert.get('flag'), '$3::boolean');
	});

	test('Pipeline-Update mit $cond', () => {
		const params = new Params();
		const { set, insert } = compileUpdate([{ $set: { at: { $cond: [{ $gt: [5, { $ifNull: ['$count', -1] }] }, new Date(0), '$at'] } } }], { fields, params });
		assert.match(set.get('at'), /^CASE WHEN \(\$1::double precision > COALESCE\("count", \$2::double precision\)\) THEN \$3::timestamptz ELSE "at" END$/);
		assert.match(insert.get('at'), /ELSE NULL END$/);
	});

	test('$group mit Summe, Sortierung und Projektion', () => {
		const { text } = compileAggregate('t', fields, [
			{ $match: { flag: true } },
			{ $group: { _id: '$name', Count: { $sum: 1 } } },
			{ $sort: { Count: -1 } },
			{ $limit: 5 },
			{ $project: { _id: 0, Label: '$_id', Count: 1 } },
		]);
		assert.match(text, /GROUP BY 1/);
		assert.match(text, /ORDER BY "Count" DESC NULLS LAST LIMIT 5/);
		assert.match(text, /^SELECT "_id" AS "Label", "Count" FROM \(SELECT /);
	});
});

// Echte Datenbank: TEST_POSTGRES_URL=postgres://user:pass@127.0.0.1/selfbot_next_test
const url = process.env.TEST_POSTGRES_URL;

describe('Postgres-Modell', { skip: url ? false : 'TEST_POSTGRES_URL fehlt' }, () => {
	const sql = require('../src/database/postgres.js');
	const { createModel } = require('../src/database/orm/model.js');
	let Item;
	let Plain;

	before(async () => {
		global.bot ??= { Logger: { error() {} } };
		sql.open({ connectionString: url });
		await sql.query('DROP TABLE IF EXISTS "orm_items", "orm_plain"');
		Item = createModel({
			name: 'Item',
			collection: 'orm_items',
			sql,
			definition: {
				_id: Number,
				name: { type: String, required: true },
				count: { type: Number, default: 0 },
				flag: { type: Boolean, default: false },
				at: { type: Date, default: () => new Date('2026-01-01T00:00:00Z') },
				tags: { type: [String], default: [] },
				data: { type: Mixed, default: {} },
				legacyId: { type: Number, default: undefined },
				kind: { type: String, enum: ['a', 'b'], default: 'a' },
			},
			indexes: [[{ legacyId: 1 }, { unique: true, partialFilterExpression: { legacyId: { $type: 'number' } } }]],
		});
		Plain = createModel({
			name: 'Plain',
			collection: 'orm_plain',
			sql,
			definition: { userId: Number, period: String, seconds: { type: Number, default: 0 }, label: String, viewers: Number, seenAt: Date },
			indexes: [[{ userId: 1, period: 1 }, { unique: true }]],
		});
		await Item.init();
		await Plain.init();
	});

	after(async () => {
		await sql.query('DROP TABLE IF EXISTS "orm_items", "orm_plain"');
		await sql.end();
	});

	test('create, Standardwerte, find mit Sortierung, Projektion und toObject', async () => {
		const created = await Item.create({ _id: 1, name: 'alpha' });
		assert.equal(created.count, 0);
		assert.equal(created.flag, false);
		assert.deepEqual(created.tags, []);
		assert.equal(created.legacyId, null);
		assert.equal(created.toObject().name, 'alpha');
		await Item.create({ _id: 2, name: 'beta', count: 5, data: { administrator: true } });
		await Item.create({ _id: 3, name: 'gamma', count: 5, tags: ['x'] });
		const sorted = await Item.find({}, { name: 1 }).sort({ count: -1, name: 1 }).limit(2).lean();
		assert.deepEqual(
			sorted.map((i) => ({ ...i })),
			[
				{ _id: 2, name: 'beta' },
				{ _id: 3, name: 'gamma' },
			],
		);
		assert.equal((await Item.findOne({ name: 'alpha' }))._id, 1);
		assert.equal(await Item.findOne({ name: 'nope' }), null);
		assert.equal((await Item.findById(3)).name, 'gamma');
		await assert.rejects(Item.create({ _id: 9, name: 'x', kind: 'z' }), /kein erlaubter Wert/);
	});

	test('Filter: Pfade, $in, Regex, $not, $or, $ne, $type', async () => {
		assert.deepEqual(
			(await Item.find({ 'data.administrator': true })).map((i) => i._id),
			[2],
		);
		assert.deepEqual(
			(await Item.find({ _id: { $in: [1, 3, 99] } }).sort({ _id: 1 })).map((i) => i._id),
			[1, 3],
		);
		assert.deepEqual(
			(await Item.find({ name: /^AL/i })).map((i) => i._id),
			[1],
		);
		assert.equal((await Item.find({ name: { $not: /^a/ } })).length, 2);
		assert.equal((await Item.find({ $or: [{ name: 'alpha' }, { count: 5 }] })).length, 3);
		assert.equal((await Item.find({ count: { $ne: 5 } })).length, 1);
		assert.equal((await Item.find({ tags: 'x' })).length, 1);
		assert.equal((await Item.find({ legacyId: { $type: 'number' } })).length, 0);
		assert.equal(await Item.countDocuments({ count: { $gte: 5 } }), 2);
		assert.deepEqual((await Item.distinct('count')).sort(), [0, 5]);
		assert.ok(await Item.exists({ name: 'beta' }));
		assert.equal(await Item.exists({ name: 'zeta' }), null);
	});

	test('updateOne: $inc, $set, JSON-Pfad, $unset', async () => {
		const result = await Item.updateOne({ _id: 1 }, { $inc: { count: 3 }, $set: { flag: true, 'data.a.b': 4 } });
		assert.equal(result.modifiedCount, 1);
		const row = await Item.findById(1);
		assert.equal(row.count, 3);
		assert.equal(row.flag, true);
		assert.deepEqual(row.data, { a: { b: 4 } });
		await Item.updateOne({ _id: 1 }, { $unset: { 'data.a': '' } });
		assert.deepEqual((await Item.findById(1)).data, {});
		await Item.updateOne({ _id: 1 }, { $max: { count: 10 } });
		assert.equal((await Item.findById(1)).count, 10);
		await Item.updateOne({ _id: 1 }, { $min: { count: 2 } });
		assert.equal((await Item.findById(1)).count, 2);
		assert.equal((await Item.updateOne({ _id: 404 }, { $set: { name: 'x' } })).matchedCount, 0);
	});

	test('Upsert mit eindeutigem Schluessel: $inc/$setOnInsert, zweimal', async () => {
		const filter = { userId: 7, period: '2026-11' };
		const first = await Plain.updateOne(filter, { $set: { label: 'a' }, $inc: { seconds: 60 }, $setOnInsert: { viewers: 5 } }, { upsert: true });
		assert.equal(first.upsertedCount, 1);
		const second = await Plain.updateOne(filter, { $set: { label: 'b' }, $inc: { seconds: 30 }, $setOnInsert: { viewers: 9 } }, { upsert: true });
		assert.equal(second.upsertedCount, 0);
		const row = await Plain.findOne(filter);
		assert.equal(row.seconds, 90);
		assert.equal(row.viewers, 5);
		assert.equal(row.label, 'b');
	});

	test('Upsert ohne eindeutigen Schluessel (Sperre) legt nur einmal an', async () => {
		await Promise.all(Array.from({ length: 5 }, () => Item.updateOne({ name: 'solo' }, { $inc: { count: 1 }, $setOnInsert: { _id: 50 } }, { upsert: true })));
		const rows = await Item.find({ name: 'solo' });
		assert.equal(rows.length, 1);
		assert.equal(rows[0].count, 5);
	});

	test('Pipeline-Update mit $cond/$max wie bei Peak-Viewern', async () => {
		const record = (viewers, at) =>
			Plain.updateOne(
				{ userId: 1, period: 'peak' },
				[{ $set: { seenAt: { $cond: [{ $gt: [viewers, { $ifNull: ['$viewers', -1] }] }, at, '$seenAt'] }, viewers: { $max: [viewers, { $ifNull: ['$viewers', viewers] }] } } }],
				{ upsert: true },
			);
		await record(10, new Date('2026-01-01T00:00:00Z'));
		await record(4, new Date('2026-02-01T00:00:00Z'));
		await record(12, new Date('2026-03-01T00:00:00Z'));
		const row = await Plain.findOne({ userId: 1, period: 'peak' });
		assert.equal(row.viewers, 12);
		assert.equal(row.seenAt.toISOString(), '2026-03-01T00:00:00.000Z');
	});

	test('aggregate: Summe je Gruppe, Jahr aus Text, Objekt-_id, leere Menge', async () => {
		await Plain.insertMany([
			{ userId: 2, period: '2025-01', seconds: 10, label: 'Abc' },
			{ userId: 2, period: '2025-02', seconds: 20, label: 'abc' },
			{ userId: 2, period: '2026-01', seconds: 5, label: 'xyz' },
		]);
		const years = await Plain.aggregate([{ $match: { userId: 2 } }, { $group: { _id: { $substrBytes: ['$period', 0, 4] }, total: { $sum: '$seconds' } } }, { $sort: { _id: 1 } }]);
		assert.deepEqual(
			years.map((i) => ({ ...i })),
			[
				{ _id: '2025', total: 30 },
				{ _id: '2026', total: 5 },
			],
		);
		const [sum] = await Plain.aggregate([{ $match: { userId: 2 } }, { $group: { _id: null, total: { $sum: '$seconds' } } }]);
		assert.equal(sum.total, 35);
		assert.deepEqual(await Plain.aggregate([{ $match: { userId: 999 } }, { $group: { _id: null, total: { $sum: '$seconds' } } }]), []);
		const byLabel = await Plain.aggregate([{ $match: { userId: 2 } }, { $group: { _id: { label: { $toLower: '$label' } }, Uses: { $sum: 1 } } }, { $sort: { Uses: -1 } }, { $limit: 1 }]);
		assert.deepEqual(byLabel[0]._id, { label: 'abc' });
		assert.equal(byLabel[0].Uses, 2);
		const stats = await Plain.aggregate([
			{ $match: { userId: 2 } },
			{ $group: { _id: '$userId', first: { $min: '$period' }, last: { $max: '$period' } } },
			{ $project: { _id: 0, Label: '$_id', first: 1 } },
		]);
		assert.deepEqual({ ...stats[0] }, { Label: 2, first: '2025-01' });
		const sample = await Plain.aggregate([{ $match: { userId: 2 } }, { $sample: { size: 1 } }]);
		assert.equal(sample.length, 1);
	});

	test('insertMany ordered:false ueberspringt Duplikate, bulkWrite, delete', async () => {
		await Item.insertMany([{ _id: 61, name: 'l1', legacyId: 1 }], { ordered: false });
		await Item.insertMany(
			[
				{ _id: 62, name: 'l1 doppelt', legacyId: 1 },
				{ _id: 63, name: 'l2', legacyId: 2 },
			],
			{ ordered: false },
		);
		assert.deepEqual(
			(await Item.find({ legacyId: { $type: 'number' } }).sort({ legacyId: 1 })).map((i) => i.name),
			['l1', 'l2'],
		);
		await Plain.bulkWrite(
			[
				{ updateOne: { filter: { userId: 3, period: 'b' }, update: { $inc: { seconds: 1 } }, upsert: true } },
				{ updateOne: { filter: { userId: 3, period: 'b' }, update: { $inc: { seconds: 2 } }, upsert: true } },
			],
			{ ordered: false },
		);
		assert.equal((await Plain.findOne({ userId: 3, period: 'b' })).seconds, 3);
		assert.equal((await Item.deleteOne({ legacyId: 2 })).deletedCount, 1);
		assert.equal((await Item.deleteMany({ legacyId: { $type: 'number' } })).deletedCount, 1);
		assert.equal((await Item.deleteMany({ name: 'gibtsnicht' })).deletedCount, 0);
	});
});
