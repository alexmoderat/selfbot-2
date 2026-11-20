// Ersatz fuer supi-cores Row (core.Query.getRow) auf Postgres, gleiche Bedienung:
//   const row = await bot.DB.getRow('Suggestion');
//   await row.load(id, true);            // oder row.load({ User_Alias: 5, Channel: 3 }, true)
//   if (row.loaded) { row.setValues({ Status: 'Done' }); await row.save({ skipLoad: true }); }
//   row.values.ID / row.values.Text      // Spaltennamen wie in MariaDB
//   await row.delete();
// Spaltennamen <-> Felder ueber toRow/fromRow (data-specs.js bzw. CORE_COLUMNS).

const createRowFactory = ({ models, toRow, fromRow, counterOf, nextId }) => {
	const getRow = async (modelName) => {
		const model = models[modelName];
		if (!model) {
			throw new Error(`Unbekannte Collection ${modelName}`);
		}

		let doc = null;
		let changes = {};
		const state = {
			loaded: false,
			values: {},
		};

		const filterOf = (identifier) => {
			if (identifier && typeof identifier === 'object') {
				return fromRow(modelName, identifier);
			}
			return { _id: identifier };
		};

		return {
			get loaded() {
				return state.loaded;
			},
			get values() {
				return state.values;
			},
			get valuesObject() {
				return { ...state.values };
			},

			/** Laedt per ID oder Spalten-Filter; ohne ignoreError ist ein fehlender Datensatz ein Fehler */
			async load(identifier, ignoreError = false) {
				doc = await model.findOne(filterOf(identifier)).lean();
				state.loaded = Boolean(doc);
				if (!doc) {
					if (!ignoreError) {
						throw new Error(`Row ${modelName} nicht gefunden: ${JSON.stringify(identifier)}`);
					}
					state.values = {};
					return;
				}
				state.values = toRow(modelName, doc);
				changes = {};
			},

			setValues(values) {
				Object.assign(state.values, values);
				Object.assign(changes, values);
			},

			/** Neu anlegen (mit naechster ID, falls die Collection einen Zaehler hat) oder Aenderungen schreiben */
			async save(options = {}) {
				const fields = fromRow(modelName, changes);
				delete fields._id;
				if (state.loaded && doc) {
					if (Object.keys(fields).length > 0) {
						await model.updateOne({ _id: doc._id }, { $set: fields });
					}
				} else {
					const counter = counterOf(modelName);
					const created = await model.create({ ...(counter ? { _id: await nextId(counter) } : {}), ...fields });
					doc = created.toObject();
					state.loaded = true;
				}
				changes = {};
				if (!options.skipLoad || !state.values.ID) {
					doc = await model.findById(doc._id).lean();
					state.values = toRow(modelName, doc);
				}
				return { insertId: doc._id };
			},

			async delete() {
				if (doc) {
					await model.deleteOne({ _id: doc._id });
				}
				state.loaded = false;
			},
		};
	};

	return getRow;
};

module.exports = { createRowFactory };
