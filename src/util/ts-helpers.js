const typedKeys = (object) => Object.keys(object);

const typedEntries = (object) => Object.entries(object);

const filterNonNullable = (array) => array.filter((i) => i !== null && i !== undefined);

const hasKey = (obj, key) => Object.hasOwn(obj, key);

function typeRegexGroups(matches) {
	if (!matches.groups) {
		throw new Error('Input RegExp does not contain groups');
	}

	return matches.groups;
}

module.exports = { typedKeys, typedEntries, filterNonNullable, hasKey, typeRegexGroups };
