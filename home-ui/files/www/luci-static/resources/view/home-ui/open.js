'use strict';
'require view';

/* LuCI menu entry that opens the Router Home interface at /home */
return view.extend({
	render: function() {
		window.location.href = '/home/';
		return E('p', {}, [ _('Opening simple mode… '), E('a', { href: '/home/' }, _('Continue')) ]);
	},
	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
