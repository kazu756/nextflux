// Keep async completion bound to this visit and merge current status/star changes.
export function createArticleContentToggle({
  activeArticle,
  loading,
  loadContent,
  onError,
}) {
  return async (article) => {
    if (!article || loading.get() || activeArticle.get()?.id !== article.id)
      return;
    let stale = false;
    const unsubscribe = activeArticle.subscribe((current) => {
      if (current?.id !== article.id) stale = true;
    });
    loading.set(true);
    try {
      const shownOriginal = !article.shownOriginal;
      const content = shownOriginal
        ? await loadContent(article)
        : article.originalContent;
      const current = activeArticle.get();
      if (!stale && current?.id === article.id)
        activeArticle.set({ ...current, content, shownOriginal });
    } catch (error) {
      if (!stale) onError(error);
    } finally {
      unsubscribe();
      loading.set(false);
    }
  };
}
