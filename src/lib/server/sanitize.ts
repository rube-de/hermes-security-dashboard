import sanitizeHtml from 'sanitize-html';

/**
 * Sanitize an agent-submitted HTML report body before it is ever stored or
 * rendered. The Hermes agent is semi-trusted, but a review report is still
 * attacker-influenced content (repo names, code snippets, etc.), so we strip
 * scripts, event handlers and dangerous URLs and keep only safe formatting.
 */
export function sanitizeReportHtml(html: string): string {
	return sanitizeHtml(html, {
		allowedTags: [
			'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
			'p', 'div', 'span', 'br', 'hr',
			'ul', 'ol', 'li',
			'strong', 'b', 'em', 'i', 'u', 'code', 'pre', 'kbd', 'samp',
			'blockquote', 'a',
			'table', 'thead', 'tbody', 'tr', 'th', 'td'
		],
		allowedAttributes: {
			a: ['href', 'title'],
			'*': ['class']
		},
		// Only safe link schemes; no javascript:/data: URLs.
		allowedSchemes: ['http', 'https', 'mailto'],
		allowProtocolRelative: false,
		// Drop the contents of these entirely rather than just unwrapping the tag.
		nonTextTags: ['style', 'script', 'textarea', 'noscript'],
		transformTags: {
			a: (tagName, attribs) => ({
				tagName,
				attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' }
			})
		}
	});
}
