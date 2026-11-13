// Collections der Features (bisher MariaDB selfbot_data), erzeugt von scripts/generate-data-specs.js und danach von
// Hand gepflegt. Je Collection: Feldname -> { column (Spalte in MariaDB, fuer die Migration), type, ... }.
// key = eindeutiger Schluessel (Upsert-Filter der Migration). counter = numerische _id ueber nextId(counter).

module.exports = [
	{
		table: 'Autoban_Log',
		model: 'AutobanLog',
		collection: 'autobanLog',
		comment: 'Wer welchen Autoban-Schalter wann umgelegt hat',
		counter: 'autobanLog',
		key: ['_id'],
		fields: {
			_id: {
				column: 'ID',
				type: 'Number',
				required: false,
			},
			channel: {
				column: 'Channel',
				type: 'Number',
				required: true,
			},
			property: {
				column: 'Property',
				type: 'String',
				required: true,
			},
			disabled: {
				column: 'Disabled',
				type: 'Boolean',
				required: true,
			},
			changedBy: {
				column: 'Changed_By',
				type: 'String',
				required: true,
			},
			source: {
				column: 'Source',
				type: 'String',
				required: true,
			},
			changed: {
				column: 'Changed',
				type: 'Date',
				required: false,
				default: 'now',
			},
		},
		indexes: [
			{
				fields: ['channel', 'property'],
				unique: false,
			},
		],
	},
	{
		table: 'Bot_Record',
		model: 'BotRecord',
		collection: 'botRecord',
		comment: 'Bot-weite Rekorde, z. B. live_channels (Cron live-record)',
		counter: null,
		key: ['name'],
		fields: {
			name: {
				column: 'Name',
				type: 'String',
				required: true,
			},
			value: {
				column: 'Value',
				type: 'Number',
				required: true,
			},
			achieved: {
				column: 'Achieved',
				type: 'Date',
				required: true,
			},
		},
		indexes: [],
	},
	{
		table: 'Category_Day_Range',
		model: 'CategoryDayRange',
		collection: 'categoryDayRange',
		comment: null,
		counter: null,
		key: ['userId', 'category'],
		fields: {
			userId: {
				column: 'User_ID',
				type: 'String',
				required: true,
			},
			category: {
				column: 'Category',
				type: 'String',
				required: true,
			},
			firstDay: {
				column: 'First_Day',
				type: 'Date',
				default: null,
				comment: 'NULL = Kategorie gab es schon vor der Tageserfassung',
			},
			lastDay: {
				column: 'Last_Day',
				type: 'Date',
				default: null,
			},
		},
		indexes: [],
	},
	{
		table: 'Category_Hours_First_Seen',
		model: 'CategoryHoursFirstSeen',
		collection: 'categoryHoursFirstSeen',
		comment: 'Tagesgenauer Start des Kategorie-Trackings (eigene Tabelle: kann per Backfill vor dem Cron-Start liegen)',
		counter: null,
		key: ['userId'],
		fields: {
			userId: {
				column: 'User_ID',
				type: 'String',
				required: true,
			},
			channelName: {
				column: 'Channel_Name',
				type: 'String',
				required: true,
			},
			firstSeen: {
				column: 'First_Seen',
				type: 'String',
				required: true,
				comment: 'YYYY-MM-DD',
			},
		},
		indexes: [],
	},
	{
		table: 'Category_Hours_Month',
		model: 'CategoryHoursMonth',
		collection: 'categoryHoursMonth',
		comment: 'Live-Sekunden je Channel, Monat und Kategorie (!hoursstreamedcategories)',
		counter: null,
		key: ['userId', 'period', 'category'],
		fields: {
			userId: {
				column: 'User_ID',
				type: 'String',
				required: true,
			},
			period: {
				column: 'Period',
				type: 'String',
				required: true,
				comment: 'YYYY-MM (UTC)',
			},
			category: {
				column: 'Category',
				type: 'String',
				required: true,
			},
			channelName: {
				column: 'Channel_Name',
				type: 'String',
				required: true,
			},
			seconds: {
				column: 'Seconds',
				type: 'Number',
				required: false,
				default: 0,
			},
		},
		indexes: [],
	},
	{
		table: 'Channel_Chatter',
		model: 'ChannelChatter',
		collection: 'channelChatter',
		comment: 'Ersatz fuer das first-msg-Tag: diesen Account hat der Bot in diesem Channel schon schreiben sehen',
		counter: null,
		key: ['channel', 'userId'],
		fields: {
			channel: {
				column: 'Channel',
				type: 'Number',
				required: true,
			},
			userId: {
				column: 'User_ID',
				type: 'String',
				required: true,
				comment: 'Twitch-User-ID',
			},
			firstSeen: {
				column: 'First_Seen',
				type: 'Date',
				required: false,
				default: 'now',
			},
		},
		indexes: [],
	},
	{
		table: 'Channel_Timer',
		model: 'ChannelTimer',
		collection: 'channelTimer',
		comment: 'Wiederkehrende Nachrichten pro Channel (!timer)',
		counter: 'channelTimer',
		key: ['_id'],
		fields: {
			_id: {
				column: 'ID',
				type: 'Number',
				required: false,
			},
			channel: {
				column: 'Channel',
				type: 'Number',
				required: true,
			},
			message: {
				column: 'Message',
				type: 'String',
				required: true,
			},
			intervalSeconds: {
				column: 'Interval_Seconds',
				type: 'Number',
				required: true,
			},
			onlineOnly: {
				column: 'Online_Only',
				type: 'Boolean',
				required: false,
				default: true,
			},
			enabled: {
				column: 'Enabled',
				type: 'Boolean',
				required: false,
				default: true,
			},
			lastSent: {
				column: 'Last_Sent',
				type: 'Date',
				default: null,
			},
			createdBy: {
				column: 'Created_By',
				type: 'String',
				default: null,
			},
			created: {
				column: 'Created',
				type: 'Date',
				required: false,
				default: 'now',
			},
		},
		indexes: [
			{
				fields: ['channel'],
				unique: false,
			},
		],
	},
	{
		table: 'Custom_Command',
		model: 'CustomCommand',
		collection: 'customCommand',
		comment: 'Eigene Chat-Commands pro Channel (!customcmd)',
		counter: 'customCommand',
		key: ['_id'],
		fields: {
			_id: {
				column: 'ID',
				type: 'Number',
				required: false,
			},
			uuid: {
				column: 'UUID',
				type: 'String',
				required: true,
			},
			channel: {
				column: 'Channel',
				type: 'Number',
				required: true,
			},
			name: {
				column: 'Name',
				type: 'String',
				required: true,
				comment: "mit '!', z. B. '!discord'",
			},
			response: {
				column: 'Response',
				type: 'String',
				required: true,
			},
			cooldown: {
				column: 'Cooldown',
				type: 'Number',
				required: false,
				default: 5,
				comment: 'Sekunden',
			},
			modOnly: {
				column: 'Mod_Only',
				type: 'Boolean',
				required: false,
				default: false,
			},
			reply: {
				column: 'Reply',
				type: 'Boolean',
				required: false,
				default: false,
			},
			onlineOnly: {
				column: 'Online_Only',
				type: 'Boolean',
				required: false,
				default: false,
			},
			offlineOnly: {
				column: 'Offline_Only',
				type: 'Boolean',
				required: false,
				default: false,
			},
			created: {
				column: 'Created',
				type: 'Date',
				required: false,
				default: 'now',
			},
		},
		indexes: [
			{
				fields: ['channel', 'name'],
				unique: true,
			},
			{
				fields: ['uuid'],
				unique: true,
			},
		],
	},
	{
		table: 'Event_Subscription',
		model: 'EventSubscription',
		collection: 'eventSubscription',
		comment: "Supibots subscribe (Block 8: nur Ereignis 'Channel live')",
		counter: 'eventSubscription',
		key: ['_id'],
		fields: {
			_id: {
				column: 'ID',
				type: 'Number',
				required: false,
			},
			userAlias: {
				column: 'User_Alias',
				type: 'Number',
				required: true,
			},
			channel: {
				column: 'Channel',
				type: 'Number',
				default: null,
			},
			platform: {
				column: 'Platform',
				type: 'Number',
				required: true,
			},
			type: {
				column: 'Type',
				type: 'String',
				required: true,
			},
			data: {
				column: 'Data',
				type: 'String',
				default: null,
			},
			flags: {
				column: 'Flags',
				type: 'String',
				default: null,
			},
			active: {
				column: 'Active',
				type: 'Boolean',
				required: false,
				default: true,
			},
			created: {
				column: 'Created',
				type: 'Date',
				required: false,
				default: 'now',
			},
			lastEdit: {
				column: 'Last_Edit',
				type: 'Date',
				default: null,
			},
		},
		indexes: [
			{
				fields: ['userAlias', 'type'],
				unique: true,
			},
			{
				fields: ['channel'],
				unique: false,
			},
		],
	},
	{
		table: 'Fake_Live_Watch',
		model: 'FakeLiveWatch',
		collection: 'fakeLiveWatch',
		comment: 'Warteliste des fake-live-watch-Crons (bis zu 1 h wiederholt abtasten)',
		counter: null,
		key: ['channelName', 'userId'],
		fields: {
			channelName: {
				column: 'Channel_Name',
				type: 'String',
				required: true,
			},
			userId: {
				column: 'User_ID',
				type: 'String',
				required: true,
			},
			expires: {
				column: 'Expires',
				type: 'Date',
				required: true,
			},
		},
		indexes: [],
	},
	{
		table: 'Justlog_Extra',
		model: 'JustlogExtra',
		collection: 'justlogExtra',
		comment: 'Channels, die justlog mitschreibt, obwohl der Bot nicht drin ist (!logchannel add)',
		counter: null,
		key: ['channelName'],
		fields: {
			channelName: {
				column: 'Channel_Name',
				type: 'String',
				required: true,
			},
			added: {
				column: 'Added',
				type: 'Date',
				required: false,
				default: 'now',
			},
		},
		indexes: [],
	},
	{
		table: 'Message_Meta_User_Alias',
		model: 'MessageMetaUserAlias',
		collection: 'messageMetaUserAlias',
		comment: 'Wie Supibots chat_data.Message_Meta_User_Alias: Nachrichtenzahl, erste und letzte Nachricht je User und Channel',
		counter: null,
		key: ['userAlias', 'channel'],
		fields: {
			userAlias: {
				column: 'User_Alias',
				type: 'Number',
				required: true,
			},
			channel: {
				column: 'Channel',
				type: 'Number',
				required: true,
			},
			messageCount: {
				column: 'Message_Count',
				type: 'Number',
				required: false,
				default: 1,
			},
			firstMessageText: {
				column: 'First_Message_Text',
				type: 'String',
				default: null,
			},
			firstMessagePosted: {
				column: 'First_Message_Posted',
				type: 'Date',
				default: null,
			},
			lastMessageText: {
				column: 'Last_Message_Text',
				type: 'String',
				default: null,
			},
			lastMessagePosted: {
				column: 'Last_Message_Posted',
				type: 'Date',
				default: null,
			},
		},
		indexes: [
			{
				fields: ['userAlias', 'lastMessagePosted'],
				unique: false,
			},
			{
				fields: ['channel', 'messageCount'],
				unique: false,
			},
		],
	},
	{
		table: 'Moderation_Ban_Log',
		model: 'ModerationBanLog',
		collection: 'moderationBanLog',
		comment: null,
		counter: 'moderationBanLog',
		key: ['_id'],
		fields: {
			_id: {
				column: 'ID',
				type: 'Number',
				required: false,
			},
			username: {
				column: 'Username',
				type: 'String',
				required: true,
			},
			userId: {
				column: 'User_ID',
				type: 'String',
				default: null,
			},
			channelName: {
				column: 'Channel_Name',
				type: 'String',
				required: true,
			},
			channel: {
				column: 'Channel',
				type: 'Number',
				default: null,
			},
			type: {
				column: 'Type',
				type: 'String',
				enum: ['ban', 'timeout', 'warn'],
				required: false,
				default: 'ban',
			},
			duration: {
				column: 'Duration',
				type: 'Number',
				default: null,
				comment: 'Sekunden bei Timeouts',
			},
			reason: {
				column: 'Reason',
				type: 'String',
				required: false,
				default: '',
			},
			status: {
				column: 'Status',
				type: 'String',
				required: false,
				default: '',
				comment: 'REGULAR, BAN EVADER, SUSPICIOUS, ...',
			},
			modName: {
				column: 'Mod_Name',
				type: 'String',
				default: null,
				comment: 'Wer gebannt hat (Bot oder Mod)',
			},
			automated: {
				column: 'Automated',
				type: 'Boolean',
				required: false,
				default: false,
				comment: '1 = automatischer Ban des Bots (zaehlt fuer !autobans)',
			},
			created: {
				column: 'Created',
				type: 'Date',
				required: false,
				default: 'now',
			},
		},
		indexes: [
			{
				fields: ['channelName'],
				unique: false,
			},
			{
				fields: ['username'],
				unique: false,
			},
			{
				fields: ['automated', 'channelName'],
				unique: false,
			},
		],
	},
	{
		table: 'Moderation_Phrase',
		model: 'ModerationPhrase',
		collection: 'moderationPhrase',
		comment: null,
		counter: 'moderationPhrase',
		key: ['_id'],
		fields: {
			_id: {
				column: 'ID',
				type: 'Number',
				required: false,
			},
			uuid: {
				column: 'UUID',
				type: 'String',
				required: true,
			},
			channel: {
				column: 'Channel',
				type: 'Number',
				default: null,
				comment: 'Channel-Phrase; NULL und Preset NULL = global',
			},
			preset: {
				column: 'Preset',
				type: 'Number',
				default: null,
				comment: 'Gehoert zu einem Preset (gilt dort, wo das Preset aktiv ist); nie zusammen mit Channel (im Code geprueft)',
			},
			name: {
				column: 'Name',
				type: 'String',
				default: null,
			},
			phrase: {
				column: 'Phrase',
				type: 'String',
				required: true,
			},
			reason: {
				column: 'Reason',
				type: 'String',
				required: false,
				default: '',
			},
			duration: {
				column: 'Duration',
				type: 'Number',
				default: null,
				comment: 'Sekunden; NULL = permanenter Ban',
			},
			isRegex: {
				column: 'Is_Regex',
				type: 'Boolean',
				required: false,
				default: false,
			},
			regexFlags: {
				column: 'Regex_Flags',
				type: 'String',
				required: false,
				default: 'i',
			},
			ignoreVip: {
				column: 'Ignore_VIP',
				type: 'Boolean',
				required: false,
				default: false,
			},
			ignoreSub: {
				column: 'Ignore_Sub',
				type: 'Boolean',
				required: false,
				default: false,
			},
			escalate: {
				column: 'Escalate',
				type: 'Boolean',
				required: false,
				default: false,
				comment: '1. Treffer nur zaehlen, 2. Timeout, ab 3. Ban',
			},
			addedBy: {
				column: 'Added_By',
				type: 'String',
				default: null,
			},
			created: {
				column: 'Created',
				type: 'Date',
				required: false,
				default: 'now',
			},
			lastUpdate: {
				column: 'Last_Update',
				type: 'Date',
				default: null,
			},
		},
		indexes: [
			{
				fields: ['uuid'],
				unique: true,
			},
			{
				fields: ['channel'],
				unique: false,
			},
			{
				fields: ['preset'],
				unique: false,
			},
		],
	},
	{
		table: 'Moderation_Phrase_Hit',
		model: 'ModerationPhraseHit',
		collection: 'moderationPhraseHit',
		comment: null,
		counter: 'moderationPhraseHit',
		key: ['_id'],
		fields: {
			_id: {
				column: 'ID',
				type: 'Number',
				required: false,
			},
			phrase: {
				column: 'Phrase',
				type: 'Number',
				default: null,
				comment: 'NULL, wenn die Phrase inzwischen geloescht ist',
			},
			phraseText: {
				column: 'Phrase_Text',
				type: 'String',
				required: true,
				comment: 'Wortlaut zum Zeitpunkt des Treffers (fuer !bpstats)',
			},
			channel: {
				column: 'Channel',
				type: 'Number',
				default: null,
			},
			hit: {
				column: 'Hit',
				type: 'Date',
				required: false,
				default: 'now',
			},
		},
		indexes: [
			{
				fields: ['phrase'],
				unique: false,
			},
		],
	},
	{
		table: 'Moderation_Preset',
		model: 'ModerationPreset',
		collection: 'moderationPreset',
		comment: null,
		counter: 'moderationPreset',
		key: ['_id'],
		fields: {
			_id: {
				column: 'ID',
				type: 'Number',
				required: false,
			},
			name: {
				column: 'Name',
				type: 'String',
				required: true,
			},
			description: {
				column: 'Description',
				type: 'String',
				default: null,
			},
			autoEnable: {
				column: 'Auto_Enable',
				type: 'Boolean',
				required: false,
				default: false,
				comment: 'Wird in neu gejointen Channels automatisch aktiviert',
			},
			createdBy: {
				column: 'Created_By',
				type: 'String',
				default: null,
			},
			created: {
				column: 'Created',
				type: 'Date',
				required: false,
				default: 'now',
			},
		},
		indexes: [
			{
				fields: ['name'],
				unique: true,
			},
		],
	},
	{
		table: 'Moderation_Preset_Channel',
		model: 'ModerationPresetChannel',
		collection: 'moderationPresetChannel',
		comment: null,
		counter: null,
		key: ['preset', 'channel'],
		fields: {
			preset: {
				column: 'Preset',
				type: 'Number',
				required: true,
			},
			channel: {
				column: 'Channel',
				type: 'Number',
				required: true,
			},
			enabledBy: {
				column: 'Enabled_By',
				type: 'String',
				default: null,
			},
			enabled: {
				column: 'Enabled',
				type: 'Date',
				required: false,
				default: 'now',
			},
		},
		indexes: [
			{
				fields: ['channel'],
				unique: false,
			},
		],
	},
	{
		table: 'Notify_Ban',
		model: 'NotifyBan',
		collection: 'notifyBan',
		comment: 'notify ban: Ansage, wenn ein Account einen Twitch-Ban bekommt; Notified = schon gemeldet (sb-v2 ban_watch)',
		counter: null,
		key: ['channel', 'login'],
		fields: {
			channel: {
				column: 'Channel',
				type: 'Number',
				required: true,
			},
			login: {
				column: 'Login',
				type: 'String',
				required: true,
			},
			message: {
				column: 'Message',
				type: 'String',
				default: null,
			},
			notified: {
				column: 'Notified',
				type: 'Date',
				default: null,
			},
			added: {
				column: 'Added',
				type: 'Date',
				required: false,
				default: 'now',
			},
		},
		indexes: [],
	},
	{
		table: 'Notify_Game_Change',
		model: 'NotifyGameChange',
		collection: 'notifyGameChange',
		comment: "Kategoriewechsel eines notify-live-Streamers waehrend des Streams ('games played' in der Offline-Ansage)",
		counter: 'notifyGameChange',
		key: ['_id'],
		fields: {
			_id: {
				column: 'ID',
				type: 'Number',
				required: false,
			},
			streamerId: {
				column: 'Streamer_ID',
				type: 'String',
				required: true,
			},
			changed: {
				column: 'Changed',
				type: 'Date',
				required: false,
				default: 'now',
			},
			game: {
				column: 'Game',
				type: 'String',
				default: null,
			},
		},
		indexes: [
			{
				fields: ['streamerId', 'changed'],
				unique: false,
			},
		],
	},
	{
		table: 'Notify_Live',
		model: 'NotifyLive',
		collection: 'notifyLive',
		comment: 'notify live: Chat-Ansage im Channel, wenn ein beliebiger Streamer live/offline geht (sb-v2 notifications)',
		counter: null,
		key: ['channel', 'streamerId'],
		fields: {
			channel: {
				column: 'Channel',
				type: 'Number',
				required: true,
			},
			streamerId: {
				column: 'Streamer_ID',
				type: 'String',
				required: true,
			},
			streamerLogin: {
				column: 'Streamer_Login',
				type: 'String',
				required: true,
			},
			message: {
				column: 'Message',
				type: 'String',
				default: null,
			},
			added: {
				column: 'Added',
				type: 'Date',
				required: false,
				default: 'now',
			},
		},
		indexes: [
			{
				fields: ['streamerId'],
				unique: false,
			},
		],
	},
	{
		table: 'Notify_Stream_State',
		model: 'NotifyStreamState',
		collection: 'notifyStreamState',
		comment: 'Laufender Stream eines notify-live-Streamers (Start, Spiel) fuer die Offline-Ansage - uebersteht Neustarts',
		counter: null,
		key: ['streamerId'],
		fields: {
			streamerId: {
				column: 'Streamer_ID',
				type: 'String',
				required: true,
			},
			started: {
				column: 'Started',
				type: 'Date',
				required: false,
				default: 'now',
			},
			game: {
				column: 'Game',
				type: 'String',
				default: null,
			},
		},
		indexes: [],
	},
	{
		table: 'Peak_Viewers',
		model: 'PeakViewers',
		collection: 'peakViewers',
		comment: 'Hoechste Zuschauerzahl je Channel und Jahr (Modul peak-viewers, !peak)',
		counter: null,
		key: ['userId', 'year'],
		fields: {
			userId: {
				column: 'User_ID',
				type: 'String',
				required: true,
				comment: 'Broadcaster',
			},
			year: {
				column: 'Year',
				type: 'Number',
				required: true,
			},
			channelName: {
				column: 'Channel_Name',
				type: 'String',
				required: true,
			},
			viewers: {
				column: 'Viewers',
				type: 'Number',
				required: false,
				default: 0,
			},
			seenAt: {
				column: 'Seen_At',
				type: 'Date',
				required: true,
			},
		},
		indexes: [],
	},
	{
		table: 'Raid_Received',
		model: 'RaidReceived',
		collection: 'raidReceived',
		comment: 'Eingehende Raids (Modul raid-tracking, !raids)',
		counter: 'raidReceived',
		key: ['_id'],
		fields: {
			_id: {
				column: 'ID',
				type: 'Number',
				required: false,
			},
			channelId: {
				column: 'Channel_ID',
				type: 'String',
				required: true,
			},
			channelName: {
				column: 'Channel_Name',
				type: 'String',
				required: true,
			},
			raiderLogin: {
				column: 'Raider_Login',
				type: 'String',
				required: true,
			},
			raiderDisplay: {
				column: 'Raider_Display',
				type: 'String',
				required: true,
			},
			viewerCount: {
				column: 'Viewer_Count',
				type: 'Number',
				required: false,
				default: 0,
			},
			seenAt: {
				column: 'Seen_At',
				type: 'Date',
				required: false,
				default: 'now',
			},
		},
		indexes: [
			{
				fields: ['channelId', 'viewerCount'],
				unique: false,
			},
		],
	},
	{
		table: 'Raid_Subscriber',
		model: 'RaidSubscriber',
		collection: 'raidSubscriber',
		comment: 'subraid: Ping, wenn ein Raid-Event (Ankuendigungs-Bot) startet',
		counter: null,
		key: ['channel', 'userAlias'],
		fields: {
			channel: {
				column: 'Channel',
				type: 'Number',
				required: true,
			},
			userAlias: {
				column: 'User_Alias',
				type: 'Number',
				required: true,
			},
			added: {
				column: 'Added',
				type: 'Date',
				required: false,
				default: 'now',
			},
		},
		indexes: [],
	},
	{
		table: 'Streak_Extra_Channel',
		model: 'StreakExtraChannel',
		collection: 'streakExtraChannel',
		comment: 'Zusaetzlich per Helix gepollte Channels ohne Join/Mod (!streaktrack)',
		counter: null,
		key: ['userId'],
		fields: {
			userId: {
				column: 'User_ID',
				type: 'String',
				required: true,
			},
			channelName: {
				column: 'Channel_Name',
				type: 'String',
				required: true,
			},
			addedBy: {
				column: 'Added_By',
				type: 'String',
				required: true,
			},
			added: {
				column: 'Added',
				type: 'Date',
				required: false,
				default: 'now',
			},
		},
		indexes: [],
	},
	{
		table: 'Stream_Game_Change',
		model: 'StreamGameChange',
		collection: 'streamGameChange',
		comment: 'Kategoriewechsel waehrend eines laufenden Streams (broadcast-settings-update)',
		counter: 'streamGameChange',
		key: ['_id'],
		fields: {
			_id: {
				column: 'ID',
				type: 'Number',
				required: false,
			},
			channel: {
				column: 'Channel',
				type: 'Number',
				required: true,
			},
			changed: {
				column: 'Changed',
				type: 'Date',
				required: false,
				default: 'now',
			},
			game: {
				column: 'Game',
				type: 'String',
				default: null,
			},
		},
		indexes: [
			{
				fields: ['channel', 'changed'],
				unique: false,
			},
		],
	},
	{
		table: 'Stream_Hash_Log',
		model: 'StreamHashLog',
		collection: 'streamHashLog',
		comment: 'Thumbnail-Hashes von Live-Followern (Fake-Live-Erkennung, 7 Tage)',
		counter: 'streamHashLog',
		key: ['_id'],
		fields: {
			_id: {
				column: 'ID',
				type: 'Number',
				required: false,
			},
			channelName: {
				column: 'Channel_Name',
				type: 'String',
				required: true,
				comment: 'Channel, dem gefolgt wurde',
			},
			userId: {
				column: 'User_ID',
				type: 'String',
				required: true,
				comment: 'Live-Follower',
			},
			hash: {
				column: 'Hash',
				type: 'String',
				required: true,
				comment: 'dHash des Thumbnails als Dezimal-Text (64 Bit, zu gross fuer Number); Vergleich mit BigInt',
			},
			seenAt: {
				column: 'Seen_At',
				type: 'Date',
				required: false,
				default: 'now',
			},
		},
		indexes: [
			{
				fields: ['seenAt'],
				unique: false,
			},
		],
	},
	{
		table: 'Stream_Hours_First_Seen',
		model: 'StreamHoursFirstSeen',
		collection: 'streamHoursFirstSeen',
		comment: 'Tagesgenauer Start des Stunden-Trackings (!hoursstreamedhistory, !streamertrack)',
		counter: null,
		key: ['userId'],
		fields: {
			userId: {
				column: 'User_ID',
				type: 'String',
				required: true,
			},
			channelName: {
				column: 'Channel_Name',
				type: 'String',
				required: true,
			},
			firstSeen: {
				column: 'First_Seen',
				type: 'String',
				required: true,
				comment: 'YYYY-MM-DD',
			},
		},
		indexes: [],
	},
	{
		table: 'Stream_Hours_Month',
		model: 'StreamHoursMonth',
		collection: 'streamHoursMonth',
		comment: 'Live-Sekunden je Channel und Monat, pro Cron-Tick addiert (!hoursstreamed)',
		counter: null,
		key: ['userId', 'period'],
		fields: {
			userId: {
				column: 'User_ID',
				type: 'String',
				required: true,
			},
			period: {
				column: 'Period',
				type: 'String',
				required: true,
				comment: 'YYYY-MM (UTC)',
			},
			channelName: {
				column: 'Channel_Name',
				type: 'String',
				required: true,
			},
			seconds: {
				column: 'Seconds',
				type: 'Number',
				required: false,
				default: 0,
			},
		},
		indexes: [],
	},
	{
		table: 'Stream_Last_Start',
		model: 'StreamLastStart',
		collection: 'streamLastStart',
		comment: 'Start und Ende des zuletzt gesehenen Streams (!lastlive)',
		counter: null,
		key: ['userId'],
		fields: {
			userId: {
				column: 'User_ID',
				type: 'String',
				required: true,
			},
			channelName: {
				column: 'Channel_Name',
				type: 'String',
				required: true,
			},
			startedAt: {
				column: 'Started_At',
				type: 'String',
				required: true,
				comment: 'ISO, UTC',
			},
			lastSeen: {
				column: 'Last_Seen',
				type: 'String',
				default: null,
				comment: 'zuletzt live gesehen (= Ende auf ein Cron-Intervall genau)',
			},
		},
		indexes: [],
	},
	{
		table: 'Stream_Log',
		model: 'StreamLog',
		collection: 'streamLog',
		comment: 'Einzelne Streams (!howmanystream), getrennt von den Streamtagen in Stream_Streak_Day',
		counter: null,
		key: ['userId', 'startedAt'],
		fields: {
			userId: {
				column: 'User_ID',
				type: 'String',
				required: true,
			},
			startedAt: {
				column: 'Started_At',
				type: 'String',
				required: true,
				comment: 'ISO, UTC',
			},
			channelName: {
				column: 'Channel_Name',
				type: 'String',
				required: true,
			},
		},
		indexes: [],
	},
	{
		table: 'Stream_State',
		model: 'StreamState',
		collection: 'streamState',
		comment: 'Laufender Stream: Startzeit und Spiel (ueberlebt Neustarts)',
		counter: null,
		key: ['channel'],
		fields: {
			channel: {
				column: 'Channel',
				type: 'Number',
				required: true,
			},
			started: {
				column: 'Started',
				type: 'Date',
				required: true,
			},
			game: {
				column: 'Game',
				type: 'String',
				default: null,
			},
		},
		indexes: [],
	},
	{
		table: 'Stream_Streak_Day',
		model: 'StreamStreakDay',
		collection: 'streamStreakDay',
		comment: 'Tage, an denen ein Channel live war (!streamerstreak, !daysstreamed, !lastlive)',
		counter: null,
		key: ['userId', 'day'],
		fields: {
			userId: {
				column: 'User_ID',
				type: 'String',
				required: true,
			},
			day: {
				column: 'Day',
				type: 'String',
				required: true,
				comment: 'UTC-Kalendertag YYYY-MM-DD, bewusst Text (kein Zeitzonen-Verschieben)',
			},
			channelName: {
				column: 'Channel_Name',
				type: 'String',
				required: true,
				comment: 'zuletzt bekannter Name, nie Schluessel',
			},
		},
		indexes: [],
	},
	{
		table: 'Suggestion',
		model: 'Suggestion',
		collection: 'suggestion',
		comment: null,
		counter: 'suggestion',
		key: ['_id'],
		fields: {
			_id: {
				column: 'ID',
				type: 'Number',
				required: false,
			},
			userAlias: {
				column: 'User_Alias',
				type: 'Number',
				default: null,
				comment: 'Author of the suggestion',
			},
			text: {
				column: 'Text',
				type: 'String',
				required: true,
				comment: 'Suggestion body',
			},
			date: {
				column: 'Date',
				type: 'Date',
				required: false,
				default: 'now',
				comment: 'Suggestion\\',
			},
			category: {
				column: 'Category',
				type: 'String',
				enum: ['Bot', 'Bot addition', 'Data', 'Legacy', 'Other', 'Other - code', 'SPM', 'Supi-core', 'Void', 'Website'],
				default: null,
			},
			status: {
				column: 'Status',
				type: 'String',
				enum: [
					'Approved',
					'Blocked',
					'Completed',
					'Moved to Github',
					'Denied',
					'Dismissed',
					'Dismissed by author',
					'Duplicate',
					'Outsourced',
					'Quarantined',
				],
				default: null,
			},
			priority: {
				column: 'Priority',
				type: 'Number',
				default: null,
			},
			notes: {
				column: 'Notes',
				type: 'String',
				default: null,
			},
			lastUpdate: {
				column: 'Last_Update',
				type: 'Date',
				default: null,
			},
			githubLink: {
				column: 'Github_Link',
				type: 'String',
				default: null,
				comment: "If the suggestion has a reference to an external site, this its link. Omits 'https:'",
			},
		},
		indexes: [
			{
				fields: ['userAlias'],
				unique: false,
			},
		],
	},
	{
		table: 'Title_Notify',
		model: 'TitleNotify',
		collection: 'titleNotify',
		comment: 'titlenotify: User wird im Channel angepingt, wenn ein Streamer den Titel aendert',
		counter: null,
		key: ['channel', 'streamerId', 'userAlias'],
		fields: {
			channel: {
				column: 'Channel',
				type: 'Number',
				required: true,
			},
			streamerId: {
				column: 'Streamer_ID',
				type: 'String',
				required: true,
			},
			streamerLogin: {
				column: 'Streamer_Login',
				type: 'String',
				required: true,
			},
			userAlias: {
				column: 'User_Alias',
				type: 'Number',
				required: true,
			},
			message: {
				column: 'Message',
				type: 'String',
				required: false,
			},
			added: {
				column: 'Added',
				type: 'Date',
				required: false,
				default: 'now',
			},
		},
		indexes: [
			{
				fields: ['streamerId'],
				unique: false,
			},
		],
	},
	{
		table: 'Tweet_Notify',
		model: 'TweetNotify',
		collection: 'tweetNotify',
		comment: 'tweetnotify: User wird im Channel angepingt, wenn ein X/Twitter-Account einen neuen Tweet postet',
		counter: null,
		key: ['channel', 'account', 'userAlias'],
		fields: {
			channel: {
				column: 'Channel',
				type: 'Number',
				required: true,
			},
			account: {
				column: 'Account',
				type: 'String',
				required: true,
			},
			message: {
				column: 'Message',
				type: 'String',
				required: false,
			},
			userAlias: {
				column: 'User_Alias',
				type: 'Number',
				required: true,
			},
			times: {
				column: 'Times',
				type: 'Number',
				required: false,
				default: 1,
			},
			added: {
				column: 'Added',
				type: 'Date',
				required: false,
				default: 'now',
			},
		},
		indexes: [
			{
				fields: ['account'],
				unique: false,
			},
		],
	},
	{
		table: 'Title_Notify_Optout',
		model: 'TitleNotifyOptout',
		collection: 'titleNotifyOptout',
		comment: 'titlenotify optout: auf diese Streamer kann niemand einen Titel-Alarm setzen',
		counter: null,
		key: ['streamerId'],
		fields: {
			streamerId: {
				column: 'Streamer_ID',
				type: 'String',
				required: true,
			},
			added: {
				column: 'Added',
				type: 'Date',
				required: false,
				default: 'now',
			},
		},
		indexes: [],
	},
	{
		table: 'Trigger_Command',
		model: 'TriggerCommand',
		collection: 'triggerCommand',
		comment: 'Trigger-Commands: Muster im Chat loesen eine Antwort aus (!addcmd)',
		counter: 'triggerCommand',
		key: ['_id'],
		fields: {
			_id: {
				column: 'ID',
				type: 'Number',
				required: false,
			},
			uuid: {
				column: 'UUID',
				type: 'String',
				required: true,
			},
			channel: {
				column: 'Channel',
				type: 'Number',
				required: true,
			},
			pattern: {
				column: 'Pattern',
				type: 'String',
				required: true,
				comment: 'Regex (Text-Trigger werden beim Anlegen escaped)',
			},
			response: {
				column: 'Response',
				type: 'String',
				required: true,
			},
			cooldown: {
				column: 'Cooldown',
				type: 'Number',
				required: false,
				default: 5,
				comment: 'Sekunden',
			},
			modOnly: {
				column: 'Mod_Only',
				type: 'Boolean',
				required: false,
				default: false,
			},
			onlineOnly: {
				column: 'Online_Only',
				type: 'Boolean',
				required: false,
				default: false,
			},
			offlineOnly: {
				column: 'Offline_Only',
				type: 'Boolean',
				required: false,
				default: false,
			},
			reply: {
				column: 'Reply',
				type: 'Boolean',
				required: false,
				default: false,
			},
			whitelist: {
				column: 'Whitelist',
				type: 'String',
				default: null,
				comment: 'JSON-Liste von Twitch-User-IDs',
			},
			globalCooldown: {
				column: 'Global_Cooldown',
				type: 'Boolean',
				required: false,
				default: false,
				comment: '1 = ein Cooldown fuer alle statt pro User',
			},
			created: {
				column: 'Created',
				type: 'Date',
				required: false,
				default: 'now',
			},
		},
		indexes: [
			{
				fields: ['uuid'],
				unique: true,
			},
			{
				fields: ['channel'],
				unique: false,
			},
		],
	},
	{
		table: 'User_Token',
		model: 'UserToken',
		collection: 'userToken',
		comment: 'OAuth-Tokens der Nutzer aus /auth/<user> (sb-v2s Auth-App, sb-v2: user_tokens)',
		counter: null,
		key: ['login'],
		fields: {
			login: {
				column: 'Login',
				type: 'String',
				required: true,
			},
			userId: {
				column: 'User_ID',
				type: 'String',
				default: null,
			},
			accessToken: {
				column: 'Access_Token',
				type: 'String',
				required: true,
			},
			refreshToken: {
				column: 'Refresh_Token',
				type: 'String',
				default: null,
			},
			expires: {
				column: 'Expires',
				type: 'Number',
				default: null,
				comment: 'ms seit Epoch',
			},
			updated: {
				column: 'Updated',
				type: 'Date',
				required: false,
				default: 'now',
			},
		},
		indexes: [],
	},
	{
		table: 'Watch_Alert',
		model: 'WatchAlert',
		collection: 'watchAlert',
		comment: 'Globale Beobachtungsliste (!watchalert): jede Nachricht wird im Mod-Log gemeldet',
		counter: null,
		key: ['login'],
		fields: {
			login: {
				column: 'Login',
				type: 'String',
				required: true,
			},
			userId: {
				column: 'User_ID',
				type: 'String',
				default: null,
			},
			reason: {
				column: 'Reason',
				type: 'String',
				default: null,
			},
			addedBy: {
				column: 'Added_By',
				type: 'String',
				default: null,
			},
			added: {
				column: 'Added',
				type: 'Date',
				required: false,
				default: 'now',
			},
		},
		indexes: [
			{
				fields: ['userId'],
				unique: false,
			},
		],
	},
	{
		table: 'Watch_Streak',
		model: 'WatchStreak',
		collection: 'watchStreak',
		comment: 'Letzter und hoechster geteilter Watch-Streak je Zuschauer und Channel (viewermilestone)',
		counter: null,
		key: ['channelId', 'userId'],
		fields: {
			channelId: {
				column: 'Channel_ID',
				type: 'String',
				required: true,
			},
			userId: {
				column: 'User_ID',
				type: 'String',
				required: true,
			},
			channelName: {
				column: 'Channel_Name',
				type: 'String',
				required: true,
			},
			login: {
				column: 'Login',
				type: 'String',
				required: true,
			},
			value: {
				column: 'Value',
				type: 'Number',
				required: true,
			},
			seenAt: {
				column: 'Seen_At',
				type: 'Date',
				required: true,
			},
			bestValue: {
				column: 'Best_Value',
				type: 'Number',
				default: null,
			},
			bestSeenAt: {
				column: 'Best_Seen_At',
				type: 'Date',
				default: null,
			},
			firstValue: {
				column: 'First_Value',
				type: 'Number',
				default: null,
			},
			firstSeenAt: {
				column: 'First_Seen_At',
				type: 'Date',
				default: null,
			},
		},
		indexes: [
			{
				fields: ['userId', 'bestValue'],
				unique: false,
			},
			{
				fields: ['channelId', 'bestValue'],
				unique: false,
			},
			{
				fields: ['bestValue'],
				unique: false,
			},
		],
	},
	{
		table: 'Watchlist',
		model: 'Watchlist',
		collection: 'watchlist',
		comment: 'Pro-Channel-Merkzettel verdaechtiger Chatter (!watchlist), rein informativ',
		counter: null,
		key: ['channel', 'login'],
		fields: {
			channel: {
				column: 'Channel',
				type: 'Number',
				required: true,
			},
			login: {
				column: 'Login',
				type: 'String',
				required: true,
			},
			reason: {
				column: 'Reason',
				type: 'String',
				default: null,
			},
			addedBy: {
				column: 'Added_By',
				type: 'String',
				default: null,
			},
			added: {
				column: 'Added',
				type: 'Date',
				required: false,
				default: 'now',
			},
		},
		indexes: [],
	},
	{
		table: 'Watchtime',
		model: 'Watchtime',
		collection: 'watchtime',
		comment: 'Watchtime pro Channel und Zuschauer (Cron watchtime, alle 5 Minuten aus der Chatterliste)',
		counter: null,
		key: ['channel', 'userId'],
		fields: {
			channel: {
				column: 'Channel',
				type: 'Number',
				required: true,
			},
			userId: {
				column: 'User_ID',
				type: 'String',
				required: true,
			},
			username: {
				column: 'Username',
				type: 'String',
				required: true,
			},
			minutes: {
				column: 'Minutes',
				type: 'Number',
				required: false,
				default: 0,
				comment: 'nur waehrend der Stream laeuft',
			},
			offlineMinutes: {
				column: 'Offline_Minutes',
				type: 'Number',
				required: false,
				default: 0,
				comment: 'im Chat, waehrend der Channel offline ist',
			},
			lastSeen: {
				column: 'Last_Seen',
				type: 'Date',
				required: false,
				default: 'now',
			},
		},
		indexes: [
			{
				fields: ['channel', 'username'],
				unique: false,
			},
		],
	},
	{
		table: 'Web_Login',
		model: 'WebLogin',
		collection: 'webLogin',
		comment: 'Reiner Twitch-Login ohne Dashboard und ohne Bot-Beitritt (Cookie sblogin)',
		counter: null,
		key: ['token'],
		fields: {
			token: {
				column: 'Token',
				type: 'String',
				required: true,
			},
			username: {
				column: 'Username',
				type: 'String',
				required: true,
			},
			userId: {
				column: 'User_ID',
				type: 'String',
				required: true,
			},
			displayName: {
				column: 'Display_Name',
				type: 'String',
				default: null,
			},
			expires: {
				column: 'Expires',
				type: 'Number',
				required: true,
				comment: 'ms seit Epoch',
			},
		},
		indexes: [
			{
				fields: ['expires'],
				unique: false,
			},
		],
	},
	{
		table: 'Web_Session',
		model: 'WebSession',
		collection: 'webSession',
		comment: 'Dashboard-Sitzungen (Cookie sbsession, 7 Tage)',
		counter: null,
		key: ['token'],
		fields: {
			token: {
				column: 'Token',
				type: 'String',
				required: true,
			},
			username: {
				column: 'Username',
				type: 'String',
				required: true,
			},
			userId: {
				column: 'User_ID',
				type: 'String',
				default: null,
			},
			channel: {
				column: 'Channel',
				type: 'String',
				required: true,
			},
			displayName: {
				column: 'Display_Name',
				type: 'String',
				default: null,
			},
			expires: {
				column: 'Expires',
				type: 'Number',
				required: true,
				comment: 'ms seit Epoch',
			},
		},
		indexes: [
			{
				fields: ['expires'],
				unique: false,
			},
		],
	},
];
