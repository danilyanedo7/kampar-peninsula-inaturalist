(() => {
  "use strict";

  const d3 = window.d3;
  if (!d3) return;

  const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fmt = d3.format(",");
  const q = (selector) => document.querySelector(selector);
  const qa = (selector) => [...document.querySelectorAll(selector)];
  const safe = (value, fallback = "") => value == null || value === "" ? fallback : value;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const escapeHtml = (value) => String(safe(value)).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" }[char]));
  const formatDate = (value) => {
    if (!value) return "";
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC"
    }).format(date);
  };

  const colors = {
    Insects: "#e5b34e",
    Plants: "#8bb48c",
    Birds: "#d8a0c2",
    Amphibians: "#77c4b6",
    Reptiles: "#da7d5c",
    Arachnids: "#b8a0d6",
    Fungi: "#d8d0ad",
    Mammals: "#dbbf93",
    Fish: "#75a9d1",
    Molluscs: "#b0c7cd",
    "Other animals": "#c98c77",
    Protozoa: "#9bbd7d",
    Chromista: "#8c9fbd",
    Unclassified: "#9a9d94"
  };

  const state = {
    data: null,
    mode: "geo",
    modeIndex: 0,
    width: 0,
    height: 0,
    scales: null,
    layouts: {},
    dotSelection: null
  };

  const load = (file) => fetch(`data/web/${file}`).then((response) => {
    if (!response.ok) throw new Error(`Could not load ${file}`);
    return response.json();
  });

  Promise.all([
    load("observations.json"),
    load("taxa.json"),
    load("observers.json"),
    load("temporal.json"),
    load("spatial.json"),
    load("distribution.json"),
    load("summary.json")
  ]).then(([observations, taxa, observers, temporal, spatial, distribution, summary]) => {
    state.data = { observations, taxa, observers, temporal, spatial, distribution, summary };
    state.data.observationIndex = new Map(observations.map((observation, index) => [observation.id, index]));
    bindMetrics();
    renderMoments();
    renderCanopy();
    renderFrequency();
    renderAttention();
    renderNetwork();
    renderEffort();
    renderTime();
    renderEnding();
    renderOrganism("geo", true);
    setupInteractions();
    window.addEventListener("resize", () => {
      if (!state.data) return;
      renderOrganism(state.mode, true);
      renderCanopy();
      renderFrequency();
      renderAttention();
      renderNetwork();
      renderEffort();
      renderTime();
      renderEnding();
    }, { passive: true });
  }).catch((error) => {
    console.error(error);
    const note = document.createElement("p");
    note.className = "data-error";
    note.textContent = "The interactive graphics could not load, but you can still read the story and methods below.";
    q("#top")?.prepend(note);
  });

  function bindMetrics() {
    const metrics = state.data.summary.metrics;
    qa("[data-bind]").forEach((element) => {
      const value = metrics[element.dataset.bind];
      if (value != null) element.textContent = fmt(value);
    });
  }

  function setupInteractions() {
    const steps = qa("[data-transform-step]");
    const modeButtons = qa("[data-mode-button]");
    const effortButtons = qa("[data-effort-metric]");
    steps.forEach((step) => step.addEventListener("click", () => setMode(Number(step.dataset.transformStep))));
    modeButtons.forEach((button) => button.addEventListener("click", () => setMode(Number(button.dataset.modeButton))));
    effortButtons.forEach((button) => button.addEventListener("click", () => {
      effortButtons.forEach((item) => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-pressed", active ? "true" : "false");
      });
      renderEffort();
    }));
    const updateModeFromScroll = () => {
      if (!steps.length) return;
      const focus = window.innerHeight * 0.48;
      const nearest = steps.reduce((closest, step) => {
        const rect = step.getBoundingClientRect();
        const distance = Math.abs(rect.top + rect.height / 2 - focus);
        return !closest || distance < closest.distance ? { step, distance } : closest;
      }, null);
      if (nearest) setMode(Number(nearest.step.dataset.transformStep));
    };
    let scrollQueued = false;
    window.addEventListener("scroll", () => {
      if (scrollQueued) return;
      scrollQueued = true;
      window.requestAnimationFrame(() => {
        scrollQueued = false;
        updateModeFromScroll();
      });
    }, { passive: true });
    window.requestAnimationFrame(updateModeFromScroll);
  }

  function setMode(modeIndex) {
    const modes = ["geo", "group", "species", "year", "observer", "geo"];
    const mode = modes[modeIndex] || "geo";
    if (state.modeIndex === modeIndex && state.dotSelection) return;
    state.mode = mode;
    state.modeIndex = modeIndex;
    qa("[data-transform-step]").forEach((item) => item.classList.toggle("is-active", Number(item.dataset.transformStep) === modeIndex));
    qa("[data-mode-button]").forEach((item) => item.classList.toggle("is-active", Number(item.dataset.modeButton) === modeIndex));
    renderOrganism(mode, false);
  }

  function stableNoise(value) {
    let hash = 0;
    const text = String(value);
    for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    return Math.abs(Math.sin(hash)) % 1;
  }

  function getScales(width, height) {
    const extent = state.data.spatial.extent;
    const x = d3.scaleLinear().domain([extent.min_lon - 0.03, extent.max_lon + 0.03]).range([28, width - 28]);
    const y = d3.scaleLinear().domain([extent.min_lat - 0.03, extent.max_lat + 0.03]).range([height - 26, 30]);
    return { x, y };
  }

  function ensureSvg() {
    const svg = q("#organism-svg");
    if (!svg) return null;
    const rect = svg.parentElement.getBoundingClientRect();
    const width = Math.max(300, rect.width);
    const height = Math.max(320, Math.min(window.innerWidth < 600 ? 410 : 720, window.innerHeight * 0.74));
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    state.width = width;
    state.height = height;
    state.scales = getScales(width, height);
    const root = d3.select(svg);
    if (root.select("g.backdrop").empty()) root.append("g").attr("class", "backdrop");
    if (root.select("g.branches").empty()) root.append("g").attr("class", "branches");
    if (root.select("g.labels").empty()) root.append("g").attr("class", "labels");
    if (root.select("g.dots").empty()) root.append("g").attr("class", "dots");
    return { svg, root, width, height };
  }

  function renderOrganism(mode, immediate) {
    if (!state.data) return;
    const view = ensureSvg();
    if (!view) return;
    state.layouts = {
      geo: buildGeoLayout(view.width, view.height),
      group: buildGroupLayout(view.width, view.height),
      species: buildSpeciesLayout(view.width, view.height),
      year: buildYearLayout(view.width, view.height),
      observer: buildObserverLayout(view.width, view.height)
    };
    drawBackdrop(view.root, mode, view.width, view.height);
    const observations = state.data.observations;
    const layout = mode === "geo" ? state.layouts.geo : state.layouts[mode]?.positions;
    if (!layout || layout.length !== observations.length || layout.some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      console.error(`Invalid observation layout for mode: ${mode}`);
      return;
    }
    const dotsLayer = view.root.select("g.dots");
    const radiusByMode = { geo: 1.45, group: 1.05, species: 1.15, year: 1.05, observer: 1.05 };
    const radius = (radiusByMode[mode] || 1.15) * (view.width < 520 ? 0.82 : 1);
    const transitionMs = reducedMotion || immediate ? 0 : 760;
    const dots = dotsLayer.selectAll("circle.observation-dot").data(observations, (d) => d.id);
    dots.exit().remove();
    const entered = dots.enter().append("circle")
      .attr("class", (d) => `observation-dot${d.obscured ? " is-obscured" : ""}`)
      .attr("r", radius)
      .attr("fill", (d) => d.group_color || colors.Unclassified)
      .attr("opacity", (d) => d.obscured ? 0.33 : 0.86)
      .attr("cx", (d, i) => state.layouts.geo[i].x)
      .attr("cy", (d, i) => state.layouts.geo[i].y);
    entered.on("pointerenter", showObservationTooltip).on("pointermove", showObservationTooltip).on("pointerleave", hideObservationTooltip).on("click", showObservationTooltip);
    state.dotSelection = entered.merge(dots);
    const activeTransition = state.dotSelection.interrupt().transition().duration(transitionMs).ease(d3.easeCubicInOut);
    activeTransition.attr("cx", (d, i) => layout[i].x).attr("cy", (d, i) => layout[i].y).attr("r", radius);
    const decor = view.root.selectAll("g.backdrop, g.branches, g.labels").interrupt();
    if (transitionMs) decor.attr("opacity", 0).transition().delay(Math.round(transitionMs * 0.55)).duration(Math.round(transitionMs * 0.4)).attr("opacity", 1);
    else decor.attr("opacity", 1);
    updateStageReadout(mode);
  }

  function updateStageReadout(mode) {
    const metrics = state.data.summary.metrics;
    const labels = {
      geo: ["where people recorded sightings", `${fmt(metrics.observations)} sightings`],
      group: ["the same sightings sorted by life group", `${state.data.summary.group_summary.length} groups`],
      species: ["the same sightings grouped by taxon", `${fmt(metrics.taxa)} taxon IDs`],
      year: ["the same sightings sorted by year", `${metrics.first_date.slice(0, 4)} to ${metrics.last_date.slice(0, 4)}`],
      observer: ["the same sightings grouped by person", `${fmt(metrics.observers)} people`]
    };
    const [label, readout] = labels[mode] || labels.geo;
    if (q("#stage-mode")) q("#stage-mode").textContent = label;
    if (q("#stage-readout")) q("#stage-readout").textContent = readout;
  }

  function drawBackdrop(root, mode, width, height) {
    const backdrop = root.select("g.backdrop");
    const branches = root.select("g.branches");
    const labels = root.select("g.labels");
    backdrop.selectAll("*").remove();
    branches.selectAll("*").remove();
    labels.selectAll("*").remove();
    if (mode === "geo") drawGeoBackdrop(backdrop, labels, width, height);
    if (mode === "group") drawGroupBackdrop(labels, width, height);
    if (mode === "species") drawSpeciesBackdrop(branches, labels, width, height);
    if (mode === "year") drawYearBackdrop(backdrop, labels, width, height);
    if (mode === "observer") drawObserverBackdrop(backdrop, labels, width, height);
  }

  function drawGeoBackdrop(backdrop, labels, width, height) {
    const { x, y } = state.scales;
    const extent = state.data.spatial.extent;
    d3.range(Math.ceil(extent.min_lon * 10) / 10, extent.max_lon + 0.1, 0.2).forEach((lon) => {
      backdrop.append("line").attr("class", "map-grid").attr("x1", x(lon)).attr("x2", x(lon)).attr("y1", 0).attr("y2", height);
    });
    d3.range(Math.ceil(extent.min_lat * 10) / 10, extent.max_lat + 0.1, 0.2).forEach((lat) => {
      backdrop.append("line").attr("class", "map-grid").attr("x1", 0).attr("x2", width).attr("y1", y(lat)).attr("y2", y(lat));
    });
    const hull = state.data.spatial.hull || [];
    if (hull.length) backdrop.append("path").datum(hull).attr("class", "map-hull").attr("d", d3.line().x((d) => x(d.lon)).y((d) => y(d.lat)));
    labels.append("text").attr("class", "map-label").attr("x", 28).attr("y", 18).text("where sightings were shared");
    labels.append("text").attr("class", "map-label").attr("x", width - 28).attr("y", 18).attr("text-anchor", "end").text("N");
  }

  function drawGroupBackdrop(labels, width, height) {
    const layout = state.layouts.group;
    layout.groupCenters.forEach((group) => {
      const label = labels.append("text").attr("class", "group-label").attr("x", group.x).attr("y", group.y);
      label.append("tspan").text(group.name);
      label.append("tspan").attr("x", group.x).attr("dy", 16).text(`${fmt(group.observations)} sightings, ${fmt(group.taxa)} taxa`);
    });
  }

  function drawSpeciesBackdrop(branches, labels, width, height) {
    const layout = state.layouts.species;
    branches.selectAll("path").data(layout.branches).join("path")
      .attr("class", (d) => d.type === "group" ? "canopy-branch group-branch" : "canopy-branch")
      .attr("d", (d) => d.path);
    layout.groupNodes.forEach((group) => {
      const label = labels.append("text").attr("class", "group-label").attr("x", group.x).attr("y", group.y);
      label.append("tspan").text(group.name);
      label.append("tspan").attr("x", group.x).attr("dy", 15).text(`${fmt(group.taxa)} taxa`);
    });
    layout.labels.forEach((item) => labels.append("text").attr("class", "species-label").attr("x", item.x).attr("y", item.y).text(item.name));
  }

  function drawYearBackdrop(backdrop, labels, width, height) {
    state.layouts.year.years.forEach((item) => {
      backdrop.append("line").attr("class", "year-guide").attr("x1", item.x).attr("x2", item.x).attr("y1", 34).attr("y2", height - 20);
      labels.append("text").attr("class", "year-label").attr("x", item.x).attr("y", 19).attr("text-anchor", "middle").text(item.year);
    });
  }

  function drawObserverBackdrop(backdrop, labels, width, height) {
    state.layouts.observer.observers.forEach((item) => {
      backdrop.append("line").attr("class", "observer-guide").attr("x1", item.xStart).attr("x2", width - 12).attr("y1", item.y).attr("y2", item.y);
      labels.append("text")
        .attr("class", "observer-label")
        .attr("x", item.xStart - 10)
        .attr("y", item.y + 3)
        .attr("text-anchor", "end")
        .text(item.label);
    });
  }

  function buildGeoLayout(width, height) {
    return state.data.observations.map((observation) => ({ x: state.scales.x(observation.lon), y: state.scales.y(observation.lat) }));
  }

  function buildGroupLayout(width, height) {
    const groups = state.data.summary.group_summary;
    const cols = width < 620 ? 2 : 3;
    const rows = Math.ceil(groups.length / cols);
    const boxW = width / cols;
    const boxH = Math.max(58, (height - 24) / rows);
    const indices = new Map();
    const positions = [];
    const centers = [];
    groups.forEach((group, groupIndex) => {
      const col = groupIndex % cols;
      const row = Math.floor(groupIndex / cols);
      const left = col * boxW;
      const top = row * boxH;
      const count = group.observations;
      const columns = Math.max(5, Math.ceil(Math.sqrt(count * (boxW - 20) / Math.max(36, boxH - 28))));
      const rowsIn = Math.ceil(count / columns);
      centers.push({ name: group.group, observations: group.observations, taxa: group.taxa, x: left + 10, y: top + 18 });
      let local = 0;
      state.data.observations.forEach((observation, index) => {
        if (observation.group !== group.group) return;
        const c = local % columns;
        const r = Math.floor(local / columns);
        const x = left + 10 + (columns === 1 ? 0 : c * (boxW - 20) / (columns - 1));
        const y = top + 52 + (rowsIn === 1 ? 0 : r * Math.max(4, boxH - 64) / (rowsIn - 1));
        positions[index] = { x: x + (stableNoise(observation.id) - 0.5) * 1.3, y: y + (stableNoise(`${observation.id}-group`) - 0.5) * 1.3 };
        local += 1;
      });
    });
    return { positions, groupCenters: centers };
  }

  function buildSpeciesLayout(width, height) {
    const groupData = state.data.summary.group_summary.map((item) => ({ name: item.group, taxa: [] }));
    const groupMap = new Map(groupData.map((item) => [item.name, item]));
    state.data.taxa.forEach((taxon) => {
      if (!groupMap.has(taxon.group)) groupMap.set(taxon.group, { name: taxon.group, taxa: [] });
      groupMap.get(taxon.group).taxa.push(taxon);
    });
    const rootData = { name: "Kampar", children: [...groupMap.values()].map((group) => ({ name: group.name, children: group.taxa })) };
    const root = d3.hierarchy(rootData).sum((d) => d.observation_count || 0).sort((a, b) => (b.value || 0) - (a.value || 0));
    const pack = d3.pack().size([width - 34, height - 52]).padding(2);
    pack(root);
    const taxonNodes = new Map(root.leaves().map((node) => [node.data.key, node]));
    const positions = [];
    state.data.observations.forEach((observation, index) => {
      const node = taxonNodes.get(observation.taxon);
      if (!node) { positions[index] = { x: width / 2, y: height / 2 }; return; }
      const angle = stableNoise(`${observation.id}-angle`) * Math.PI * 2;
      const distance = Math.sqrt(stableNoise(`${observation.id}-distance`)) * Math.max(0.6, node.r * 0.72);
      positions[index] = { x: node.x + Math.cos(angle) * distance, y: node.y + Math.sin(angle) * distance };
    });
    const centerX = width / 2;
    const centerY = height - 22;
    const branches = [];
    root.descendants().filter((node) => node.depth > 0).forEach((node) => {
      const parent = node.parent;
      const type = node.depth === 1 ? "group" : "taxon";
      branches.push({ type, path: `M${parent.x},${parent.y} Q${(parent.x + node.x) / 2},${(parent.y + node.y) / 2 - 16} ${node.x},${node.y}` });
    });
    root.children.forEach((group) => {
      branches.push({ type: "group", path: `M${centerX},${centerY} Q${centerX},${(centerY + group.y) / 2} ${group.x},${group.y}` });
    });
    const groupNodes = root.children.map((node) => ({ name: node.data.name, x: node.x, y: node.y - Math.max(8, node.r) - 8, taxa: node.leaves().length }));
    const labels = root.leaves().filter((node) => node.data.observation_count >= 35).slice(0, 18).map((node) => ({ name: node.data.scientific, x: node.x + Math.min(8, node.r + 2), y: node.y - Math.min(6, node.r + 2) }));
    return { positions, branches, groupNodes, labels };
  }

  function buildYearLayout(width, height) {
    const years = state.data.temporal.map((item) => item.year);
    const xScale = d3.scalePoint().domain(years).range([28, width - 28]);
    const grouped = d3.group(state.data.observations, (d) => d.year);
    const positions = [];
    years.forEach((year) => {
      const records = grouped.get(year) || [];
      records.forEach((observation, local) => {
        const spread = Math.min(width / Math.max(1, years.length) * 0.56, 22);
        positions[state.data.observationIndex.get(observation.id)] = {
          x: xScale(year) + (stableNoise(`${observation.id}-year-x`) - 0.5) * spread,
          y: 36 + (local / Math.max(1, records.length - 1)) * (height - 70) + (stableNoise(`${observation.id}-year-y`) - 0.5) * 2
        };
      });
    });
    return { positions, years: years.map((year) => ({ year, x: xScale(year) })) };
  }

  function buildObserverLayout(width, height) {
    const namedCount = width < 520 ? 7 : 10;
    const namedObservers = state.data.observers.slice(0, namedCount);
    const namedSet = new Set(namedObservers.map((d) => d.observer));
    const otherCount = Math.max(0, state.data.observers.length - namedObservers.length);
    const rowKeys = [...namedObservers.map((d) => d.observer), "__other__"];
    const left = width < 520 ? 104 : 148;
    const right = 12;
    const yScale = d3.scaleBand().domain(rowKeys).range([30, height - 16]).paddingInner(0.25);
    const positions = [];
    const grouped = d3.group(state.data.observations, (d) => namedSet.has(d.observer) ? d.observer : "__other__");
    rowKeys.forEach((key) => {
      const records = grouped.get(key) || [];
      const bandHeight = yScale.bandwidth();
      const availableWidth = Math.max(40, width - left - right);
      const columns = Math.max(1, Math.ceil(Math.sqrt(records.length * availableWidth / Math.max(10, bandHeight - 6))));
      const rows = Math.max(1, Math.ceil(records.length / columns));
      records.forEach((observation, local) => {
        const column = local % columns;
        const row = Math.floor(local / columns);
        positions[state.data.observationIndex.get(observation.id)] = {
          x: left + (columns === 1 ? availableWidth / 2 : column * availableWidth / (columns - 1)),
          y: yScale(key) + 3 + (rows === 1 ? bandHeight / 2 : row * Math.max(2, bandHeight - 6) / (rows - 1))
        };
      });
    });
    const observerLookup = new Map(namedObservers.map((d) => [d.observer, d]));
    const rows = rowKeys.map((key) => {
      const item = observerLookup.get(key);
      const name = item ? safe(item.display_name, item.observer) : `${otherCount} other observers`;
      const compactName = name.length > (width < 520 ? 14 : 20) ? `${name.slice(0, width < 520 ? 11 : 17)}...` : name;
      return { label: compactName, xStart: left, y: yScale(key) + yScale.bandwidth() / 2 };
    });
    return { positions, observers: rows };
  }

  function showObservationTooltip(event, observation) {
    const tooltip = q("#organism-tooltip");
    const frame = q(".opening-stage");
    if (!tooltip || !frame) return;
    const bounds = frame.getBoundingClientRect();
    const frameSvg = q("#organism-svg").getBoundingClientRect();
    tooltip.innerHTML = `<strong>${escapeHtml(observation.scientific)}</strong>${observation.common ? `<span>${escapeHtml(observation.common)}</span>` : ""}<span>${escapeHtml(formatDate(observation.date))}, ${escapeHtml(observation.group)}<br>${escapeHtml(observation.observer)}, ${escapeHtml(observation.quality || "quality not specified")}</span>`;
    tooltip.style.left = `${clamp(event.clientX - bounds.left + 12, 8, bounds.width - tooltip.offsetWidth - 8)}px`;
    tooltip.style.top = `${clamp(event.clientY - frameSvg.top + 12, 8, bounds.height - tooltip.offsetHeight - 8)}px`;
    tooltip.classList.add("is-visible");
  }

  function hideObservationTooltip() {
    q("#organism-tooltip")?.classList.remove("is-visible");
  }

  function buildCanopyTree() {
    const groupMap = new Map();
    state.data.taxa.forEach((taxon) => {
      if (!groupMap.has(taxon.group)) groupMap.set(taxon.group, new Map());
      const genus = safe(taxon.genus, "Unidentified");
      if (!groupMap.get(taxon.group).has(genus)) groupMap.get(taxon.group).set(genus, []);
      groupMap.get(taxon.group).get(genus).push({ ...taxon, name: taxon.scientific });
    });
    return {
      name: "Kampar record",
      children: [...groupMap.entries()].map(([group, genera]) => ({
        name: group,
        group,
        children: [...genera.entries()].map(([genus, leaves]) => ({ name: genus, group, children: leaves }))
      }))
    };
  }

  function showCanopyTooltip(event, taxon, frame) {
    const tooltip = q("#canopy-tooltip");
    if (!tooltip) return;
    const bounds = frame.getBoundingClientRect();
    const research = taxon.research_grade_count || 0;
    const needsId = Math.max(0, (taxon.observation_count || 0) - research);
    tooltip.innerHTML = `${taxon.image_url ? `<img class="tip-image" src="${escapeHtml(taxon.image_url)}" alt="${escapeHtml(taxon.common || taxon.scientific)}">` : ""}<div class="tip-group">${escapeHtml(taxon.group)}</div><strong>${escapeHtml(taxon.scientific)}</strong>${taxon.common ? `<span>${escapeHtml(taxon.common)}</span>` : ""}<span>${fmt(taxon.observation_count)} sightings from ${fmt(taxon.observer_count)} people<br>${fmt(research)} are research grade and ${fmt(needsId)} still need an ID<br>Seen from ${escapeHtml(formatDate(taxon.first_date))} to ${escapeHtml(formatDate(taxon.last_date))}</span>`;
    tooltip.style.left = `${clamp(event.clientX - bounds.left + 14, 8, bounds.width - tooltip.offsetWidth - 8)}px`;
    tooltip.style.top = `${clamp(event.clientY - bounds.top - 18, 8, bounds.height - tooltip.offsetHeight - 8)}px`;
    tooltip.classList.add("is-visible");
  }

  function renderCanopy() {
    const svg = q("#canopy-svg");
    if (!svg || !state.data) return;
    const frame = svg.parentElement;
    const width = Math.max(300, frame.getBoundingClientRect().width);
    const height = Math.max(440, Math.min(window.innerWidth < 600 ? 620 : 760, window.innerHeight * 0.84));
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.innerHTML = "";
    const root = d3.hierarchy(buildCanopyTree())
      .sum((d) => d.observation_count || 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0));
    d3.treemap()
      .tile(d3.treemapSquarify.ratio(1))
      .size([width, height])
      .round(true)
      .paddingOuter(1)
      .paddingTop((d) => d.depth === 1 ? ((d.value || 0) >= 100 ? 22 : 4) : 1)
      .paddingInner((d) => d.depth === 0 ? 5 : d.depth === 1 ? 2 : 0.7)(root);
    const group = d3.select(svg).append("g");
    const colorsFor = (name) => state.data.summary.colors[name] || colors.Unclassified;
    const groupNodes = root.descendants().filter((d) => d.depth === 1);
    const genusNodes = root.descendants().filter((d) => d.depth === 2 && d.x1 - d.x0 > 4 && d.y1 - d.y0 > 4);
    const leaves = root.leaves();
    group.append("g").selectAll("rect.canopy-group-block")
      .data(groupNodes)
      .join("rect")
      .attr("class", "canopy-group-block")
      .attr("x", (d) => d.x0).attr("y", (d) => d.y0)
      .attr("width", (d) => Math.max(0, d.x1 - d.x0)).attr("height", (d) => Math.max(0, d.y1 - d.y0))
      .attr("stroke", (d) => colorsFor(d.data.group));
    group.append("g").selectAll("rect.canopy-genus-block")
      .data(genusNodes)
      .join("rect")
      .attr("class", "canopy-genus-block")
      .attr("x", (d) => d.x0).attr("y", (d) => d.y0)
      .attr("width", (d) => Math.max(0, d.x1 - d.x0)).attr("height", (d) => Math.max(0, d.y1 - d.y0));
    group.append("g").selectAll("rect.canopy-leaf")
      .data(leaves)
      .join("rect")
      .attr("class", "canopy-leaf")
      .attr("x", (d) => d.x0).attr("y", (d) => d.y0)
      .attr("width", (d) => Math.max(0, d.x1 - d.x0))
      .attr("height", (d) => Math.max(0, d.y1 - d.y0))
      .attr("fill", (d) => colorsFor(d.data.group))
      .attr("stroke", (d) => (d.data.research_grade_count || 0) / Math.max(1, d.data.observation_count || 1) >= 0.75 ? "#505050" : colors.Reptiles)
      .attr("stroke-width", (d) => (d.data.research_grade_count || 0) / Math.max(1, d.data.observation_count || 1) >= 0.75 ? 0.35 : 0.9)
      .attr("opacity", 0.88)
      .on("pointerenter", (event, d) => showCanopyTooltip(event, d.data, frame))
      .on("pointermove", (event, d) => showCanopyTooltip(event, d.data, frame))
      .on("pointerleave", () => q("#canopy-tooltip")?.classList.remove("is-visible"))
      .on("click", (event, d) => {
        event.stopPropagation();
        showCanopyTooltip(event, d.data, frame);
      });
    group.append("g").selectAll("text")
      .data(groupNodes.filter((d) => d.x1 - d.x0 > 58 && d.y1 - d.y0 > 28))
      .join("text")
      .attr("class", "canopy-group-label")
      .attr("x", (d) => d.x0 + 7)
      .attr("y", (d) => d.y0 + 16)
      .attr("fill", (d) => colorsFor(d.data.group))
      .text((d) => `${d.data.name}, ${fmt(d.value || 0)}`);
    const legend = q("#canopy-legend");
    if (legend) legend.innerHTML = `<span class="canopy-legend-item"><i class="canopy-legend-size"></i>block size = sightings</span>${state.data.summary.group_summary.slice(0, 9).map((item) => `<span class="canopy-legend-item"><i class="canopy-legend-dot" style="background:${escapeHtml(item.color)}"></i>${escapeHtml(item.group)}</span>`).join("")}`;
  }

  function renderFrequency() {
    const svg = q("#frequency-svg");
    if (!svg || !state.data) return;
    const width = Math.max(280, svg.parentElement.getBoundingClientRect().width);
    const height = window.innerWidth < 600 ? 300 : 390;
    const margin = { top: 18, right: 14, bottom: 42, left: 10 };
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.innerHTML = "";
    const maxObs = d3.max(state.data.taxa, (d) => d.observation_count) || 1;
    const x = d3.scaleLog().domain([1, Math.max(2, maxObs)]).range([margin.left, width - margin.right]);
    const layer = d3.select(svg).append("g");
    [1, 2, 10, 50, maxObs].filter((value, index, values) => value <= maxObs && values.indexOf(value) === index).forEach((value) => {
      layer.append("line").attr("class", "frequency-guide").attr("x1", x(value)).attr("x2", x(value)).attr("y1", margin.top).attr("y2", height - margin.bottom);
      layer.append("text").attr("class", "frequency-axis").attr("x", x(value)).attr("y", height - 16).attr("text-anchor", "middle").text(fmt(value));
    });
    layer.selectAll("circle")
      .data(state.data.taxa)
      .join("circle")
      .attr("class", "frequency-dot")
      .attr("cx", (d) => x(Math.max(1, d.observation_count)))
      .attr("cy", (d, index) => margin.top + 16 + ((index * 31) % Math.max(36, height - margin.top - margin.bottom - 28)))
      .attr("r", (d) => 1.15 + Math.min(4.8, Math.sqrt(d.observation_count) * 0.39))
      .attr("fill", (d) => state.data.summary.colors[d.group] || colors.Unclassified)
      .attr("opacity", 0.8)
      .on("pointerenter", (event, d) => {
        const readout = q("#frequency-readout");
        if (readout) readout.textContent = `${d.scientific}, ${fmt(d.observation_count)} sighting${d.observation_count === 1 ? "" : "s"}`;
      });
    const singleton = state.data.distribution[0]?.taxa || 0;
    if (q("#frequency-readout")) q("#frequency-readout").textContent = `${fmt(singleton)} taxa were seen once`;
  }

  function renderAttention() {
    const svg = q("#attention-svg");
    if (!svg || !state.data) return;
    const width = Math.max(280, svg.parentElement.getBoundingClientRect().width);
    const height = window.innerWidth < 600 ? 390 : 460;
    const margin = {
      top: 8,
      right: window.innerWidth < 600 ? 48 : 58,
      bottom: 8,
      left: window.innerWidth < 600 ? 118 : 190
    };
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.innerHTML = "";
    const rows = state.data.observers.slice(0, 12);
    const maxCount = d3.max(rows, (d) => d.observation_count) || 1;
    const x = d3.scaleLinear().domain([0, maxCount]).range([margin.left, width - margin.right]);
    const y = d3.scaleBand().domain(rows.map((d) => d.observer)).range([margin.top, height - margin.bottom]).paddingInner(0.22);
    const layer = d3.select(svg).append("g");
    const rowY = (d) => y(d.observer) + y.bandwidth() / 2;
    layer.selectAll("line.observer-line")
      .data(rows)
      .join("line")
      .attr("class", "observer-line")
      .attr("x1", x(0))
      .attr("x2", (d) => x(d.observation_count))
      .attr("y1", rowY)
      .attr("y2", rowY);
    layer.selectAll("circle.observer-dot")
      .data(rows)
      .join("circle")
      .attr("class", "observer-dot")
      .attr("cx", (d) => x(d.observation_count))
      .attr("cy", rowY)
      .attr("r", (d, index) => index === 0 ? 6 : 4.5)
      .attr("opacity", (d, index) => 1 - index * 0.035);
    layer.selectAll("text.observer-name")
      .data(rows)
      .join("text")
      .attr("class", "observer-name")
      .attr("x", margin.left - 10)
      .attr("y", rowY)
      .attr("text-anchor", "end")
      .attr("dominant-baseline", "middle")
      .text((d) => {
        const name = safe(d.display_name, d.observer);
        const limit = width < 430 ? 16 : 28;
        return name.length > limit ? `${name.slice(0, limit - 3)}...` : name;
      });
    layer.selectAll("text.observer-value")
      .data(rows)
      .join("text")
      .attr("class", "observer-value")
      .attr("x", (d) => x(d.observation_count) + 8)
      .attr("y", rowY)
      .attr("text-anchor", "start")
      .attr("dominant-baseline", "middle")
      .text((d) => fmt(d.observation_count));
    const topFive = d3.sum(rows.slice(0, 5), (d) => d.observation_count);
    if (q("#attention-readout")) q("#attention-readout").textContent = `the top five added ${Math.round((topFive / state.data.summary.metrics.observations) * 100)}% of all sightings`;
  }

  function hexPath(cx, cy, radius) {
    return d3.range(6).map((index) => {
      const angle = Math.PI / 6 + index * Math.PI / 3;
      return `${index ? "L" : "M"}${cx + radius * Math.cos(angle)},${cy + radius * Math.sin(angle)}`;
    }).join("") + "Z";
  }

  function renderNetwork() {
    const svg = q("#network-svg");
    if (!svg || !state.data) return;
    const width = Math.max(280, svg.parentElement.getBoundingClientRect().width);
    const height = window.innerWidth < 600 ? 390 : 560;
    const margin = { top: 44, right: 160, bottom: 24, left: 128 };
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.innerHTML = "";
    const observerRows = state.data.observers.slice(0, 9);
    const taxonRows = [...state.data.taxa].sort((a, b) => b.observation_count - a.observation_count).slice(0, 16);
    const observerSet = new Set(observerRows.map((d) => d.observer));
    const taxonSet = new Set(taxonRows.map((d) => d.key));
    const observerNodes = new Map(observerRows.map((d, index) => [d.observer, {
      id: d.observer,
      label: safe(d.display_name, d.observer),
      x: margin.left,
      y: margin.top + ((index + 0.5) / observerRows.length) * (height - margin.top - margin.bottom),
      value: d.observation_count,
      type: "observer"
    }]));
    const taxonNodes = new Map(taxonRows.map((d, index) => [d.key, {
      id: d.key,
      label: d.scientific,
      x: width - margin.right,
      y: margin.top + ((index + 0.5) / taxonRows.length) * (height - margin.top - margin.bottom),
      value: d.observation_count,
      group: d.group,
      type: "taxon"
    }]));
    const links = d3.rollups(
      state.data.observations.filter((d) => observerSet.has(d.observer) && taxonSet.has(d.taxon)),
      (rows) => rows.length,
      (d) => `${d.observer}|||${d.taxon}`
    ).map(([key, value]) => {
      const [observer, taxon] = key.split("|||");
      return { source: observerNodes.get(observer), target: taxonNodes.get(taxon), value };
    }).filter((d) => d.source && d.target);
    const maxLink = d3.max(links, (d) => d.value) || 1;
    const layer = d3.select(svg).append("g");
    layer.append("text").attr("class", "network-label heading").attr("x", margin.left).attr("y", 18).attr("text-anchor", "middle").text("people");
    layer.append("text").attr("class", "network-label heading").attr("x", width - margin.right).attr("y", 18).attr("text-anchor", "middle").text("life");
    layer.selectAll("path.network-link")
      .data(links)
      .join("path")
      .attr("class", "network-link")
      .attr("stroke", (d) => state.data.summary.colors[d.target.group] || colors.Unclassified)
      .attr("stroke-width", (d) => 0.5 + Math.sqrt(d.value / maxLink) * 4.2)
      .attr("d", (d) => `M${d.source.x},${d.source.y} C${width * 0.38},${d.source.y} ${width * 0.62},${d.target.y} ${d.target.x},${d.target.y}`)
      .on("pointerenter", (event, d) => {
        if (q("#network-readout")) q("#network-readout").textContent = `${d.source.label} recorded ${d.target.label} ${fmt(d.value)} time${d.value === 1 ? "" : "s"}`;
      });
    layer.selectAll("circle.network-node.observer")
      .data([...observerNodes.values()])
      .join("circle")
      .attr("class", "network-node observer")
      .attr("cx", (d) => d.x).attr("cy", (d) => d.y)
      .attr("r", (d) => 3 + Math.min(4, Math.sqrt(d.value) * 0.08));
    layer.selectAll("circle.network-node.taxon")
      .data([...taxonNodes.values()])
      .join("circle")
      .attr("class", "network-node taxon")
      .attr("cx", (d) => d.x).attr("cy", (d) => d.y)
      .attr("r", (d) => 2.2 + Math.min(4.5, Math.sqrt(d.value) * 0.22))
      .attr("fill", (d) => state.data.summary.colors[d.group] || colors.Unclassified);
    layer.selectAll("text.network-label.observer")
      .data([...observerNodes.values()])
      .join("text")
      .attr("class", "network-label observer")
      .attr("x", (d) => d.x - 11).attr("y", (d) => d.y + 3)
      .attr("text-anchor", "end")
      .text((d) => d.label);
    layer.selectAll("text.network-label.taxon")
      .data([...taxonNodes.values()])
      .join("text")
      .attr("class", "network-label taxon")
      .attr("x", (d) => d.x + 11).attr("y", (d) => d.y + 3)
      .text((d) => d.label);
    if (q("#network-readout")) q("#network-readout").textContent = `${observerRows.length} people, ${taxonRows.length} taxa and ${fmt(links.length)} visible connections`;
  }

  function renderEnding() {
    if (!state.data) return;
    const last = state.data.observations[state.data.observations.length - 1];
    const mark = q("#last-observation-mark");
    const text = q("#last-observation-text");
    if (mark) mark.style.background = last.group_color || colors.Unclassified;
    if (text) {
      const latestName = last.scientific === "Amata"
        ? "a handmaiden moth in the genus Amata"
        : `${safe(last.common, last.scientific)}${last.common ? `, identified as ${last.scientific}` : ""}`;
      text.textContent = `On ${formatDate(last.date)}, someone shared a sighting of ${latestName}. It became one more sighting in the shared record.`;
    }
  }

  function renderEffort() {
    const svg = q("#effort-svg");
    if (!svg || !state.data) return;
    const width = Math.max(280, svg.parentElement.getBoundingClientRect().width);
    const height = window.innerWidth < 600 ? 360 : 680;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.innerHTML = "";
    const cells = state.data.spatial.cells || [];
    const scales = getScales(width, height);
    const metric = q("[data-effort-metric].is-active")?.dataset.effortMetric || "taxa";
    const labels = {
      taxa: { default: "Taxa seen in each 5 km cell.", selected: "Taxa seen in this cell" },
      observations: { default: "Sightings shared from each 5 km cell.", selected: "Sightings shared from this cell" },
      observers: { default: "People who shared sightings from each 5 km cell.", selected: "People who shared sightings from this cell" },
      dates: { default: "Days with sightings in each 5 km cell.", selected: "Days with sightings in this cell" }
    };
    const max = d3.max(cells, (d) => d[metric]) || 1;
    const color = d3.scaleSequential().domain([0, Math.sqrt(max)]).interpolator(d3.interpolateRgb("#252525", "#e5b34e"));
    const layer = d3.select(svg).append("g");
    layer.append("text").attr("class", "map-label").attr("x", 28).attr("y", 20).text("the same places counted in four ways");
    const radius = clamp(Math.min(width / 68, height / 46), 5.5, 11);
    layer.selectAll("path")
      .data(cells)
      .join("path")
      .attr("class", "effort-cell")
      .attr("d", (d) => hexPath(scales.x(d.lon), scales.y(d.lat), radius))
      .attr("fill", (d) => color(Math.sqrt(d[metric] || 0)))
      .attr("opacity", (d) => d[metric] > 0 ? 0.92 : 0.2)
      .attr("stroke", (d) => d.obscured > d.observations / 2 ? colors.Reptiles : colors.Unclassified)
      .on("pointerenter", (event, d) => updateEffortCaption(d, labels[metric].selected))
      .on("click", (event, d) => updateEffortCaption(d, labels[metric].selected));
    if (q("#effort-caption")) q("#effort-caption").textContent = labels[metric].default;
  }

  function updateEffortCaption(cell, label) {
    const metric = q("[data-effort-metric].is-active")?.dataset.effortMetric || "taxa";
    const caption = q("#effort-caption");
    if (caption) caption.textContent = `${label}: ${fmt(cell[metric])}, with ${fmt(cell.observations)} sightings in total`;
  }

  function renderTime() {
    const svg = q("#time-svg");
    if (!svg || !state.data) return;
    const width = Math.max(280, svg.parentElement.getBoundingClientRect().width);
    const height = window.innerWidth < 600 ? 300 : 540;
    const margin = { top: 20, right: 48, bottom: 38, left: 48 };
    const rows = state.data.temporal;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.innerHTML = "";
    const x = d3.scaleLinear().domain(d3.extent(rows, (d) => d.year)).range([margin.left, width - margin.right]);
    const yObs = d3.scaleLinear().domain([0, d3.max(rows, (d) => d.cumulative_observations)]).nice().range([height - margin.bottom, margin.top]);
    const yTaxa = d3.scaleLinear().domain([0, d3.max(rows, (d) => d.cumulative_taxa)]).nice().range([height - margin.bottom, margin.top]);
    const layer = d3.select(svg).append("g");
    layer.append("g").attr("class", "time-axis").attr("transform", `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x).ticks(Math.min(7, rows.length)).tickFormat(d3.format("d")));
    layer.append("g").attr("class", "time-axis").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(yObs).ticks(4).tickFormat(d3.format("~s")));
    layer.append("g").attr("class", "time-axis").attr("transform", `translate(${width - margin.right},0)`).call(d3.axisRight(yTaxa).ticks(4).tickFormat(d3.format("~s")));
    const obsLine = d3.line().x((d) => x(d.year)).y((d) => yObs(d.cumulative_observations)).curve(d3.curveMonotoneX);
    const taxaLine = d3.line().x((d) => x(d.year)).y((d) => yTaxa(d.cumulative_taxa)).curve(d3.curveMonotoneX);
    layer.append("path").datum(rows).attr("class", "time-area").attr("d", `${obsLine(rows)}L${x(rows[rows.length - 1].year)},${height - margin.bottom}L${x(rows[0].year)},${height - margin.bottom}Z`);
    layer.append("path").datum(rows).attr("class", "time-line-obs").attr("d", obsLine);
    layer.append("path").datum(rows).attr("class", "time-line-taxa").attr("d", taxaLine);
    layer.selectAll("circle.time-dot-obs").data(rows).join("circle").attr("class", "time-dot-obs").attr("cx", (d) => x(d.year)).attr("cy", (d) => yObs(d.cumulative_observations)).attr("r", 3.1);
    layer.selectAll("circle.time-dot-taxa").data(rows).join("circle").attr("class", "time-dot-taxa").attr("cx", (d) => x(d.year)).attr("cy", (d) => yTaxa(d.cumulative_taxa)).attr("r", 3.1);
    layer.append("text").attr("class", "time-label").attr("x", x(rows[rows.length - 1].year) - 4).attr("y", yObs(rows[rows.length - 1].cumulative_observations) - 12).attr("text-anchor", "end").text(fmt(rows[rows.length - 1].cumulative_observations));
    layer.append("text").attr("class", "time-label").attr("x", x(rows[rows.length - 1].year) - 4).attr("y", yTaxa(rows[rows.length - 1].cumulative_taxa) + 18).attr("text-anchor", "end").text(fmt(rows[rows.length - 1].cumulative_taxa));
  }

  function renderMoments() {
    const target = q("#moments-grid");
    if (!target || !state.data) return;
    target.innerHTML = (state.data.summary.moments || []).map((moment) => `
      <article class="moment">
        <div class="moment-media"><img src="${escapeHtml(moment.image_url)}" alt="${escapeHtml(moment.common || moment.scientific)}" loading="lazy" referrerpolicy="no-referrer"></div>
        <div class="moment-copy">
          <p class="moment-role">${escapeHtml(moment.role)}</p>
          <h3>${escapeHtml(moment.scientific)}</h3>
          ${moment.common ? `<p class="moment-common">${escapeHtml(moment.common)}</p>` : ""}
          <p class="moment-credit">Seen ${escapeHtml(formatDate(moment.observed_on))}, ${escapeHtml(moment.license)}<br>Photo: ${escapeHtml(moment.photographer)}. <a href="${escapeHtml(moment.url)}">View the sighting</a></p>
        </div>
      </article>`).join("");
  }
})();
