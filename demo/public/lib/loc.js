import { h, createContext, cloneElement } from 'preact';
import { useContext, useMemo, useReducer, useEffect, useRef } from 'preact/hooks';

const UPDATE = (state, url, push) => {
	if (url && url.type === 'click') {
		const link = url.target.closest('a[href]');
		if (!link || link.origin != location.origin) return state;

		url.preventDefault();
		push = true;
		url = link.href.replace(location.origin, '');
	} else if (typeof url !== 'string') {
		url = location.pathname + location.search;
	}

	if (push === true) history.pushState(null, '', url);
	else if (push === false) history.replaceState(null, '', url);
	return url;
};

const EMPTY = {};
function exec(url, route, opts) {
	let reg = /(?:\?([^#]*))?(#.*)?$/,
		c = url.match(reg),
		matches = {},
		ret;

	if (c && c[1]) {
		let p = c[1].split('&');
		for (let i=0; i<p.length; i++) {
			let r = p[i].split('=');
			matches[decodeURIComponent(r[0])] = decodeURIComponent(r.slice(1).join('='));
		}
	}

	url = segmentize(url.replace(reg, ''));
	route = segmentize(route || '');
	let max = Math.max(url.length, route.length);
	for (let i=0; i<max; i++) {
		if (route[i] && route[i].charAt(0)===':') {
			let param = route[i].replace(/(^:|[+*?]+$)/g, ''),
				flags = (route[i].match(/[+*?]+$/) || EMPTY)[0] || '',
				plus = ~flags.indexOf('+'),
				star = ~flags.indexOf('*'),
				val = url[i] || '';

			if (!val && !star && (flags.indexOf('?')<0 || plus)) {
				ret = false;
				break;
			}

			matches[param] = decodeURIComponent(val);
			if (plus || star) {
				matches[param] = url.slice(i).map(decodeURIComponent).join('/');
				break;
			}
		}
		else if (route[i] !== url[i]) {
			ret = false;
			break;
		}
	}

	if (opts.default!==true && ret===false) return false;

	return matches;
}

const segmentize = (url) => url.replace(/(^\/+|\/+$)/g, '').split('/');
const rankSegment = (segment) => segment.charAt(0)==':' ? (1 + '*+?'.indexOf(segment.charAt(segment.length-1))) || 4 : 5;
const rank = (path) => segmentize(path).map(rankSegment).join('');
const rankChild = (vnode) => vnode.props.default ? 0 : rank(vnode.props.path);

const pathRankSort = (a, b) => (
	(a.rank < b.rank) ? 1 :
		(a.rank > b.rank) ? -1 :
			(a.index - b.index)
);

// filter out VNodes without attributes (which are unrankeable), and add `index`/`rank` properties to be used in sorting.
function prepareVNodeForRanking(vnode, index) {
	vnode.index = index;
	vnode.rank = rankChild(vnode);
	return vnode.props;
}

export function LocationProvider(props) {
	const [url, route] = useReducer(UPDATE, location.pathname + location.search);

	const value = useMemo(() => {
		const u = new URL(url, location.origin);
		const path = u.pathname.replace(/(.)\/$/g, '$1');
		// @ts-ignore-next
		return { url, path, query: Object.fromEntries(u.searchParams), route };
	}, [url]);

	useEffect(() => {
		addEventListener('click', route);
		addEventListener('popstate', route);

		return () => {
			removeEventListener('click', route);
			removeEventListener('popstate', route);
		};
	});

	// @ts-ignore
	return h(LocationProvider.ctx.Provider, { value }, props.children);
}

export function Router(props) {
	const [, update] = useReducer(c => c + 1, 0);

	const loc = useLoc();

	const { url, path, query } = loc;

	const cur = useRef(loc);
	const prev = useRef();
	const curChildren = useRef();
	const prevChildren = useRef();
	const pending = useRef();

	if (url !== cur.current.url) {
		pending.current = null;
		prev.current = cur.current;
		prevChildren.current = curChildren.current;
		cur.current = loc;
	}

	this.componentDidCatch = err => {
		if (err && err.then) pending.current = err;
	};

	useEffect(() => {
		let p = pending.current;

		const commit = () => {
			if (cur.current.url !== url || pending.current !== p) return;
			if (props.onLoadEnd) props.onLoadEnd(url);
			prev.current = prevChildren.current = null;
			update(0);
		};

		if (p) {
			if (props.onLoadStart) props.onLoadStart(url);
			p.then(commit);
		} else commit();
	}, [url]);

	curChildren.current = props.children
		.filter(prepareVNodeForRanking)
		.sort(pathRankSort)
		.map(vnode => exec(url, vnode.props.path, vnode.props) ? cloneElement(vnode, { path, query }) : null)
		.filter(Boolean);

	if (curChildren.current.length > 1) curChildren.current = curChildren.current.filter(x => !x.props.default)

	return curChildren.current.concat(prevChildren.current || []);
}

Router.Provider = LocationProvider;

LocationProvider.ctx = createContext(/** @type {{ url: string, path: string, query: object, route }} */ ({}));

export const useLoc = () => useContext(LocationProvider.ctx);
export const useLocation = useLoc;
