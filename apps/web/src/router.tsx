import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router';
import { Layout } from './components/Layout';
import { CommentView } from './views/CommentView';
import { KeywordListView } from './views/KeywordListView';
import { KeywordView } from './views/KeywordView';
import { SettingsView } from './views/SettingsView';
import { TagListView } from './views/TagListView';
import { TagView } from './views/TagView';

const rootRoute = createRootRoute({ component: Layout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/keywords' });
  },
});

const keywordsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/keywords',
  component: KeywordListView,
});

const keywordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/keywords/$keywordId',
  component: KeywordView,
});

const tagsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tags',
  component: TagListView,
});

const tagRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tags/$tagId',
  component: TagView,
});

export interface CommentSearch {
  tag?: number;
  keyword?: number;
}

const commentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/comments',
  component: CommentView,
  validateSearch: (search: Record<string, unknown>): CommentSearch => {
    const toId = (value: unknown): number | undefined => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    };
    return { tag: toId(search.tag), keyword: toId(search.keyword) };
  },
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsView,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  keywordsRoute,
  keywordRoute,
  tagsRoute,
  tagRoute,
  commentsRoute,
  settingsRoute,
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
