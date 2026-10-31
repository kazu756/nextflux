import { lazy, Suspense, useMemo } from "react";
import parse from "html-react-parser";
import translationSafeText from "@/domain/articles/translationSafeText.js";
import { PhotoProvider } from "react-photo-view";
import { useStore } from "@nanostores/react";
import { settingsState } from "@/stores/settingsStore.js";
import ArticleImage from "./ArticleImage.jsx";
import Attachments from "./Attachments.jsx";
import Iframe from "./Iframe.jsx";
import MediaPlayer from "./MediaPlayer.jsx";
import AudioLaunchButton from "@/components/GlobalAudio/AudioLaunchButton.jsx";
import MediaLinkPill from "./MediaLinkPill.jsx";
import { resolveMediaSource } from "@/domain/articles/mediaSource.js";
import {
  getArticleMedia,
  getMediaEnclosures,
  hasMediaContent,
} from "@/domain/articles/articleMedia.js";
import { imageGalleryActive } from "@/stores/articlesStore.js";
import { cn, getFontSizeClass } from "@/lib/utils.js";
import {
  hasImageContent,
  normalizeCode,
} from "@/domain/articles/articleHtml.js";
const CodeBlock = lazy(() => import("./CodeBlock.jsx"));
function renderLinkedImages(node) {
  const images = node.children.filter(
    (child) => child.type === "tag" && child.name === "img",
  );
  if (images.length === 0) return node;
  return (
    <>
      {images.map((image, index) => (
        <ArticleImage imgNode={image} key={image.attribs?.src || index} />
      ))}
      <MediaLinkPill href={node.attribs.href} />
    </>
  );
}
function replaceArticleNode(
  node,
  article,
  enclosures,
  useThirdPartyMediaPlayer,
) {
  if (node.type !== "tag") return undefined;
  if (node.name === "audio" || node.name === "video") {
    if (node.name === "video" && !useThirdPartyMediaPlayer) return undefined;
    const media = getArticleMedia(node);
    const urls = [media.src, ...media.sources.map((source) => source.src)];
    const enclosure = enclosures?.find((item) => urls.includes(item.url));
    if (node.name === "audio") {
      return (
        <AudioLaunchButton article={article} {...media} enclosure={enclosure} />
      );
    }
    return (
      <MediaPlayer
        key={`${article.id}:${enclosure?.id || media.src}`}
        {...media}
        enclosure={enclosure}
      />
    );
  }
  if (node.name === "img") return <ArticleImage imgNode={node} />;
  if (node.name === "a" && node.children.length > 0) {
    return renderLinkedImages(node);
  }
  if (node.name === "p" && (hasImageContent(node) || hasMediaContent(node))) {
    node.name = "div";
    return node;
  }
  if (node.name === "iframe") {
    const media = resolveMediaSource(node.attribs?.src);
    if (useThirdPartyMediaPlayer && media.adapter !== "native")
      return (
        <MediaPlayer
          kind={media.kind}
          src={media.src}
          title={node.attribs?.title}
        />
      );
    return <Iframe domNode={node} />;
  }
  if (node.name !== "pre") return undefined;
  const codeNode = node.children.find(
    (child) => child.type === "tag" && child.name === "code",
  );
  const code = normalizeCode(codeNode || node);
  if (!code) return node;
  return (
    <Suspense
      fallback={
        <pre className="overflow-x-auto">
          <code>{code}</code>
        </pre>
      }
    >
      <CodeBlock code={code} />
    </Suspense>
  );
}
export default function ArticleContent({
  article,
  alignJustify,
  fontSize,
  lineHeight,
}) {
  const { useThirdPartyMediaPlayer } = useStore(settingsState);
  const { content, inlineUrls } = useMemo(() => {
    const inlineUrls = [];
    const content = parse(article.content, {
      transform: translationSafeText,
      replace: (node) => {
        if (node.name === "audio" || node.name === "video") {
          const media = getArticleMedia(node);
          inlineUrls.push(
            media.src,
            ...media.sources.map((source) => source.src),
          );
        }
        if (
          node.name === "iframe" &&
          resolveMediaSource(node.attribs?.src).adapter !== "native"
        )
          inlineUrls.push(node.attribs.src);
        return replaceArticleNode(
          node,
          article,
          article.enclosures,
          useThirdPartyMediaPlayer,
        );
      },
    });
    return { content, inlineUrls };
  }, [article, useThirdPartyMediaPlayer]);
  const mediaEnclosures = getMediaEnclosures(article.enclosures, inlineUrls);
  return (
    <>
      {mediaEnclosures.map((enclosure) =>
        enclosure.mime_type?.toLowerCase().startsWith("audio/") ? (
          <AudioLaunchButton
            key={`${article.id}:${enclosure.url}`}
            article={article}
            kind="audio"
            src={enclosure.url}
            type={enclosure.mime_type}
            title={enclosure.title || article.title}
            enclosure={enclosure}
          />
        ) : useThirdPartyMediaPlayer ? (
          <MediaPlayer
            key={`${article.id}:${enclosure.url}`}
            kind="video"
            src={enclosure.url}
            type={enclosure.mime_type}
            title={enclosure.title || article.title}
            enclosure={enclosure}
          />
        ) : null,
      )}
      <PhotoProvider
        bannerVisible
        onVisibleChange={(visible) => imageGalleryActive.set(visible)}
        maskOpacity={0.8}
        loop={false}
        speed={() => 300}
      >
        {/* Replace the host subtree only when HTML changes: translation may have
            replaced text nodes that React would otherwise reconcile. */}
        <div
          key={article.content}
          className={cn(
            "article-content prose max-w-none",
            "prose-pre:rounded-lg prose-pre:shadow-small",
            "prose-h1:text-[1.5em] prose-h2:text-[1.25em] prose-h3:text-[1.125em] prose-h4:text-[1em]",
            getFontSizeClass(fontSize),
          )}
          style={{
            lineHeight: `${lineHeight}em`,
            textAlign: alignJustify ? "justify" : "left",
          }}
        >
          {content}
          <Attachments article={article} />
        </div>
      </PhotoProvider>
    </>
  );
}
