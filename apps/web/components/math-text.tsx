"use client";
import katex from "katex";
export function MathText({ text }: { text: string }) {
  return (
    <div className="math-text">
      {text.split(/(\$\$[\s\S]*?\$\$|\$[^$]+\$)/g).map((part, i) =>
        part.startsWith("$") ? (
          <span
            key={i}
            dangerouslySetInnerHTML={{
              __html: katex.renderToString(part.replace(/^\$\$?|\$\$?$/g, ""), {
                throwOnError: false,
                displayMode: part.startsWith("$$"),
                trust: false,
              }),
            }}
          />
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </div>
  );
}
