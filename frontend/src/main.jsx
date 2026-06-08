import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import mermaid from "mermaid";
import ReactMarkdown from "react-markdown";
import { deflateRaw } from "pako";
import {
  Atom,
  Bot,
  BrainCircuit,
  Database,
  FileText,
  GitFork,
  LoaderCircle,
  Minus,
  Network,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  UploadCloud,
} from "lucide-react";
import "./styles.css";

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "loose",
  theme: "base",
  themeVariables: {
    background: "transparent",
    primaryColor: "#102538",
    primaryTextColor: "#f5fbff",
    primaryBorderColor: "#67e8f9",
    lineColor: "#7dd3fc",
    secondaryColor: "#3a1c5f",
    tertiaryColor: "#14332d",
    fontFamily: "Inter, ui-sans-serif, system-ui",
  },
});

const emptyAsk = {
  question: "",
  answer: "",
  sources: [],
};

function formatError(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  return error.detail || error.message || "Ocurrió un error inesperado";
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new Error(formatError(body));
  }

  return body;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodeHtmlEntities(value) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

function extractMermaidGraph(code) {
  const nodes = new Map();
  const edges = [];

  function readNode(raw) {
    const trimmed = raw.trim().replace(/;$/, "");
    const match = trimmed.match(
      /^([A-Za-z][\w-]*)\s*(?:\[\s*"([^"]+)"\s*\]|\[\s*([^\]]+)\s*\]|\(\s*"([^"]+)"\s*\)|\(\s*([^)]+)\s*\)|\{\s*"([^"]+)"\s*\}|\{\s*([^}]+)\s*\})?/
    );
    if (!match) return null;
    const id = match[1];
    const label = match.slice(2).find(Boolean) || id;
    nodes.set(id, decodeHtmlEntities(label.replace(/^["']|["']$/g, "").trim()));
    return id;
  }

  for (const line of code.split("\n")) {
    const cleanLine = line.trim();
    if (!cleanLine || /^(flowchart|graph)\b/i.test(cleanLine)) continue;

    const parts = cleanLine.split(/\s*(?:-->|---|==>)\s*/);
    if (parts.length >= 2) {
      const from = readNode(parts[0]);
      const to = readNode(parts[1]);
      if (from && to) edges.push({ from, to });
    } else {
      readNode(cleanLine);
    }
  }

  return { nodes: Array.from(nodes.entries()), edges };
}

function mermaidToDrawioXml(code) {
  const { nodes, edges } = extractMermaidGraph(code);
  const usableNodes = nodes.length ? nodes : [["answer", "Respuesta"]];
  const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(usableNodes.length))));
  const width = 190;
  const height = 76;
  const gapX = 90;
  const gapY = 80;
  const cells = [];
  const idMap = new Map();

  usableNodes.forEach(([id, label], index) => {
    const cellId = `n${index + 1}`;
    idMap.set(id, cellId);
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = 60 + col * (width + gapX);
    const y = 60 + row * (height + gapY);
    cells.push(
      `<mxCell id="${cellId}" value="${escapeXml(label)}" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#102538;strokeColor=#67e8f9;fontColor=#f5fbff;" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${width}" height="${height}" as="geometry"/></mxCell>`
    );
  });

  edges.forEach((edge, index) => {
    const source = idMap.get(edge.from);
    const target = idMap.get(edge.to);
    if (!source || !target) return;
    cells.push(
      `<mxCell id="e${index + 1}" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;strokeColor=#7dd3fc;" edge="1" parent="1" source="${source}" target="${target}"><mxGeometry relative="1" as="geometry"/></mxCell>`
    );
  });

  return `<mxfile host="app.diagrams.net"><diagram name="RAG Nexus"><mxGraphModel dx="1100" dy="720" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join("")}</root></mxGraphModel></diagram></mxfile>`;
}

function svgToDrawioXml(svg) {
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1]?.split(/\s+/).map(Number);
  const viewWidth = viewBox?.[2] || Number(svg.match(/width="(\d+(?:\.\d+)?)/)?.[1]) || 900;
  const viewHeight = viewBox?.[3] || Number(svg.match(/height="(\d+(?:\.\d+)?)/)?.[1]) || 700;
  const width = Math.max(420, Math.min(1400, Math.round(viewWidth)));
  const height = Math.max(320, Math.min(1200, Math.round(viewHeight)));
  const imageUri = `data:image/svg+xml,${encodeURIComponent(svg)}`;

  return `<mxfile host="app.diagrams.net"><diagram name="RAG Nexus"><mxGraphModel dx="1100" dy="720" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${width + 120}" pageHeight="${height + 120}" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="diagram" value="" style="shape=image;html=1;verticalLabelPosition=bottom;verticalAlign=top;imageAspect=1;aspect=fixed;image=${escapeXml(imageUri)};" vertex="1" parent="1"><mxGeometry x="60" y="60" width="${width}" height="${height}" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`;
}

function encodeDrawioXml(xml) {
  const encoded = encodeURIComponent(xml);
  const compressed = deflateRaw(encoded);
  let binary = "";
  compressed.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return encodeURIComponent(btoa(binary));
}

function NeuralBackdrop() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let width = 0;
    let height = 0;
    let frame = 0;
    let animationId = 0;
    const particles = Array.from({ length: 64 }, (_, index) => ({
      seed: index * 71,
      radius: 1.5 + (index % 5) * 0.35,
    }));

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw() {
      frame += 0.004;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "rgba(3, 9, 18, 0.42)";
      ctx.fillRect(0, 0, width, height);

      const points = particles.map((particle, index) => {
        const x =
          width * (0.12 + ((Math.sin(frame * 0.9 + particle.seed) + 1) / 2) * 0.78);
        const y =
          height * (0.1 + ((Math.cos(frame * 1.1 + particle.seed * 0.7) + 1) / 2) * 0.78);
        return { ...particle, x, y, index };
      });

      ctx.lineWidth = 1;
      for (let i = 0; i < points.length; i += 1) {
        for (let j = i + 1; j < points.length; j += 1) {
          const a = points[i];
          const b = points[j];
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          if (distance < 145) {
            const alpha = (1 - distance / 145) * 0.18;
            ctx.strokeStyle = `rgba(103, 232, 249, ${alpha})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      for (const point of points) {
        const pulse = 0.35 + Math.sin(frame * 7 + point.seed) * 0.25;
        ctx.fillStyle = `rgba(125, 211, 252, ${0.35 + pulse})`;
        ctx.beginPath();
        ctx.arc(point.x, point.y, point.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      animationId = requestAnimationFrame(draw);
    }

    resize();
    draw();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationId);
    };
  }, []);

  return <canvas className="neural-backdrop" ref={canvasRef} aria-hidden="true" />;
}

function StatusPill({ icon: Icon, label, tone = "blue" }) {
  return (
    <span className={`status-pill ${tone}`}>
      <Icon size={15} />
      {label}
    </span>
  );
}

function App() {
  const [documents, setDocuments] = useState([]);
  const [selectedDocument, setSelectedDocument] = useState("");
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [question, setQuestion] = useState("");
  const [topK, setTopK] = useState(5);
  const [asking, setAsking] = useState(false);
  const [diagramming, setDiagramming] = useState(false);
  const [askResult, setAskResult] = useState(emptyAsk);
  const [mermaidCode, setMermaidCode] = useState("");
  const [diagramSvg, setDiagramSvg] = useState("");
  const [diagramZoom, setDiagramZoom] = useState(2.5);
  const [error, setError] = useState("");

  const selectedDocumentName = useMemo(() => {
    const doc = documents.find((item) => String(item.id) === String(selectedDocument));
    return doc?.filename || "Todos los documentos";
  }, [documents, selectedDocument]);

  async function loadDocuments() {
    try {
      const data = await requestJson("/api/query/documents");
      setDocuments(data.documents || []);
    } catch (err) {
      setError(formatError(err));
    }
  }

  useEffect(() => {
    loadDocuments();
  }, []);

  useEffect(() => {
    let ignore = false;

    async function renderDiagram() {
      if (!mermaidCode.trim()) {
        setDiagramSvg("");
        return;
      }

      try {
        const id = `diagram-${Date.now()}`;
        const result = await mermaid.render(id, mermaidCode);
        if (!ignore) {
          setDiagramSvg(result.svg);
        }
      } catch (err) {
        if (!ignore) {
          setError(`No se pudo renderizar el diagrama: ${formatError(err)}`);
        }
      }
    }

    renderDiagram();
    return () => {
      ignore = true;
    };
  }, [mermaidCode]);

  async function handleUpload(event) {
    event.preventDefault();
    if (!file) {
      setError("Seleccioná un PDF para cargar.");
      return;
    }

    const payload = new FormData();
    payload.append("file", file);
    setUploading(true);
    setError("");
    setUploadMessage("");

    try {
      const data = await requestJson("/api/ingest/ingest", {
        method: "POST",
        body: payload,
      });
      setUploadMessage(
        data.status === "already_ingested"
          ? `Documento ya indexado. ID ${data.document_id}.`
          : `PDF indexado: ${data.pages} páginas, ${data.chunks} chunks.`
      );
      setSelectedDocument(String(data.document_id));
      setFile(null);
      event.target.reset();
      await loadDocuments();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteDocument(doc) {
    const shouldDelete = window.confirm(`Eliminar "${doc.filename}" y todos sus chunks indexados?`);
    if (!shouldDelete) return;

    setError("");
    try {
      await requestJson(`/api/query/documents/${doc.id}`, {
        method: "DELETE",
      });
      if (String(selectedDocument) === String(doc.id)) {
        setSelectedDocument("");
      }
      setAskResult(emptyAsk);
      setMermaidCode("");
      setDiagramSvg("");
      await loadDocuments();
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleAsk(event) {
    event.preventDefault();
    if (!question.trim()) {
      setError("Escribí una pregunta para buscar en los textos.");
      return;
    }

    setAsking(true);
    setError("");
    setMermaidCode("");
    setDiagramSvg("");
    setDiagramZoom(2.5);
    setAskResult(emptyAsk);

    try {
      const data = await requestJson("/api/query/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          document_id: selectedDocument ? Number(selectedDocument) : null,
          top_k: Number(topK),
        }),
      });
      setAskResult(data);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setAsking(false);
    }
  }

  async function handleDiagram() {
    if (!askResult.answer) {
      setError("Primero ejecutá una búsqueda para generar un diagrama.");
      return;
    }

    setDiagramming(true);
    setError("");

    try {
      const data = await requestJson("/api/query/diagram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: askResult.question || question,
          answer: askResult.answer,
          sources: askResult.sources || [],
        }),
      });
      setMermaidCode(data.mermaid);
      setDiagramZoom(2.5);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setDiagramming(false);
    }
  }

  async function openDrawio() {
    if (!diagramSvg.trim()) {
      setError("Generá un diagrama primero.");
      return;
    }

    try {
      const xml = svgToDrawioXml(diagramSvg);
      const payload = encodeDrawioXml(xml);
      window.open(`https://app.diagrams.net/?splash=0&ui=atlas#R${payload}`, "_blank");
    } catch (err) {
      setError(`No pude abrir el diagrama en draw.io: ${formatError(err)}`);
    }
  }

  return (
    <>
      <NeuralBackdrop />
      <main className="app-shell">
        <section className="hero-panel">
          <div className="brand-mark">
            <BrainCircuit size={34} />
          </div>
          <div>
            <p className="eyebrow">RAG local con Ollama + pgvector</p>
            <h1>RAG Nexus</h1>
            <p className="subtitle">
              Cargá PDFs, consultá su contenido con IA local y convertí cada respuesta
              en un mapa conceptual listo para draw.io.
            </p>
          </div>
          <div className="system-strip" aria-label="Estado del sistema">
            <StatusPill icon={Database} label="Postgres" tone="green" />
            <StatusPill icon={Bot} label="Ollama" tone="blue" />
            <StatusPill icon={Network} label="draw.io" tone="violet" />
          </div>
        </section>

        {error ? (
          <section className="alert" role="alert">
            {error}
          </section>
        ) : null}

        <section className="mission-grid">
          <div className="panel ingest-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Ingesta</p>
                <h2>Base documental</h2>
              </div>
              <button className="icon-button" onClick={loadDocuments} title="Actualizar documentos">
                <RefreshCw size={18} />
              </button>
            </div>

            <form onSubmit={handleUpload} className="upload-zone">
              <label className="drop-target">
                <UploadCloud size={30} />
                <span>{file ? file.name : "Arrastrá o seleccioná un PDF"}</span>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(event) => setFile(event.target.files?.[0] || null)}
                />
              </label>
              <button className="primary-button" type="submit" disabled={uploading}>
                {uploading ? <LoaderCircle className="spin" size={18} /> : <UploadCloud size={18} />}
                {uploading ? "Indexando..." : "Cargar PDF"}
              </button>
            </form>

            {uploadMessage ? <p className="success-line">{uploadMessage}</p> : null}

            <div className="document-list">
              {documents.length === 0 ? (
                <p className="muted">Todavía no hay documentos indexados.</p>
              ) : (
                documents.map((doc) => (
                  <div
                    key={doc.id}
                    className={`document-row ${String(doc.id) === String(selectedDocument) ? "active" : ""}`}
                  >
                    <button
                      className="document-select"
                      onClick={() => setSelectedDocument(String(doc.id))}
                    >
                    <FileText size={18} />
                    <span>
                      <strong>{doc.filename}</strong>
                      <small>
                        ID {doc.id} · {doc.page_count || 0} páginas · {doc.chunk_count || 0} chunks
                      </small>
                    </span>
                    </button>
                    <button
                      className="delete-document-button"
                      onClick={() => handleDeleteDocument(doc)}
                      title="Eliminar documento"
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="panel query-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Consulta</p>
                <h2>Búsqueda semántica</h2>
              </div>
              <StatusPill icon={Atom} label={selectedDocumentName} tone="blue" />
            </div>

            <form onSubmit={handleAsk} className="ask-form">
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Preguntá algo sobre tus PDFs..."
                rows={5}
              />

              <div className="query-controls">
                <label>
                  Documento
                  <select
                    value={selectedDocument}
                    onChange={(event) => setSelectedDocument(event.target.value)}
                  >
                    <option value="">Todos</option>
                    {documents.map((doc) => (
                      <option key={doc.id} value={doc.id}>
                        {doc.filename}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Top K
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={topK}
                    onChange={(event) => setTopK(event.target.value)}
                  />
                </label>
                <button className="primary-button search-button" type="submit" disabled={asking}>
                  {asking ? <LoaderCircle className="spin" size={18} /> : <Search size={18} />}
                  {asking ? "Buscando..." : "Buscar"}
                </button>
              </div>
            </form>
          </div>
        </section>

        <section className="results-grid">
          <div className="panel answer-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Resultado</p>
                <h2>Respuesta del modelo</h2>
              </div>
              <button
                className="secondary-button"
                onClick={handleDiagram}
                disabled={!askResult.answer || diagramming}
              >
                {diagramming ? <LoaderCircle className="spin" size={18} /> : <GitFork size={18} />}
                {diagramming ? "Dibujando..." : "Generar diagrama"}
              </button>
            </div>

            <article className="answer-body">
              {askResult.answer ? (
                <ReactMarkdown>{askResult.answer}</ReactMarkdown>
              ) : (
                "La respuesta aparecerá acá cuando ejecutes una búsqueda."
              )}
            </article>

            <div className="sources">
              {(askResult.sources || []).map((source, index) => (
                <span key={`${source.document_id}-${source.page_no}-${source.chunk_no}-${index}`}>
                  p.{source.page_no} · chunk {source.chunk_no} · distancia {source.distance.toFixed(4)}
                </span>
              ))}
            </div>
          </div>

          <div className="panel diagram-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Concept map</p>
                <h2>Diagrama draw.io</h2>
              </div>
              <div className="diagram-actions">
                <button
                  className="icon-button"
                  onClick={() => setDiagramZoom((value) => Math.max(0.45, Number((value - 0.15).toFixed(2))))}
                  disabled={!diagramSvg}
                  title="Alejar"
                >
                  <Minus size={18} />
                </button>
                <span className="zoom-readout">{Math.round(diagramZoom * 100)}%</span>
                <button
                  className="icon-button"
                  onClick={() => setDiagramZoom((value) => Math.min(4, Number((value + 0.15).toFixed(2))))}
                  disabled={!diagramSvg}
                  title="Acercar"
                >
                  <Plus size={18} />
                </button>
                <button className="secondary-button" onClick={openDrawio} disabled={!mermaidCode}>
                  <Send size={18} />
                  Abrir en draw.io
                </button>
              </div>
            </div>

            <div className="diagram-stage">
              {diagramSvg ? (
                <div
                  className="diagram-viewport"
                  style={{ transform: `scale(${diagramZoom})` }}
                  dangerouslySetInnerHTML={{ __html: diagramSvg }}
                />
              ) : (
                <p className="muted">Generá un diagrama conceptual desde la respuesta.</p>
              )}
            </div>

            {mermaidCode ? (
              <details className="mermaid-source">
                <summary>Mermaid generado</summary>
                <pre>{mermaidCode}</pre>
              </details>
            ) : null}
          </div>
        </section>
      </main>
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
