import {
  activeArticle,
  updateArticleStarred,
  updateArticleStatus,
  markAllAsRead,
  markAboveAsRead,
  markBelowAsRead,
  loadingOriginContent,
} from "../stores/articlesStore.js";
import minifluxAPI from "@/api/miniflux";
import { reportError } from "@/lib/errors.js";
import { toast } from "sonner";
import {
  fetchReaderContent,
  BunshunArticleError,
} from "@/api/bunshunArticles.js";
import { createArticleContentToggle } from "@/services/articleContentToggle.js";

// 处理文章状态更新
export const handleMarkStatus = async (article) => {
  try {
    await updateArticleStatus(article);
  } catch (err) {
    reportError(err, "article.updateStatus");
  }
};

// 处理文章星标状态更新
export const handleToggleStar = async (article) => {
  try {
    await updateArticleStarred(article);
  } catch (err) {
    reportError(err, "article.updateStarred");
  }
};

// 处理标记所有文章为已读
export const handleMarkAllRead = async (type, id) => {
  try {
    switch (type) {
      case "feed":
        await markAllAsRead("feed", id);
        break;
      case "category":
        await markAllAsRead("category", id);
        break;
      default:
        await markAllAsRead();
    }
  } catch (err) {
    reportError(err, "article.markAllRead");
  }
};

// 处理标记上方文章为已读
export const handleMarkAboveAsRead = async (articleId) => {
  try {
    await markAboveAsRead(articleId);
  } catch (err) {
    reportError(err, "article.markAboveRead");
  }
};

// 处理标记下方文章为已读
export const handleMarkBelowAsRead = async (articleId) => {
  try {
    await markBelowAsRead(articleId);
  } catch (err) {
    reportError(err, "article.markBelowRead");
  }
};

// 处理内容切换
export const handleToggleContent = createArticleContentToggle({
  activeArticle,
  loading: loadingOriginContent,
  loadContent: (article) => {
    const worker = import.meta.env.VITE_BUNSHUN_ARTICLE_WORKER_URL;
    return fetchReaderContent(article, worker, minifluxAPI.fetchEntryContent);
  },
  onError: (error) => {
    reportError(error, "article.toggleContent");
    if (error instanceof BunshunArticleError) toast.error(error.message);
  },
});
