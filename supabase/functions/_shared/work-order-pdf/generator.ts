import pdfMake from "pdfmake/build/pdfmake.js";
import pdfFonts from "pdfmake/build/vfs_fonts.js";
import type {
  Content,
  TableCell,
  TDocumentDefinitions,
} from "pdfmake/interfaces";

import type { WorkOrderPdfSnapshot } from "./model";

const sarajevoTimeZone = "Europe/Sarajevo";
const borderColor = "#1f2933";
const subtleFill = "#e9edf0";
const brandRed = "#b51f2e";

function textCell(
  text: string,
  options: {
    alignment?: "center" | "left" | "right";
    bold?: boolean;
    fillColor?: string;
    fontSize?: number;
  } = {},
): TableCell {
  return {
    text,
    alignment: options.alignment ?? "left",
    bold: options.bold ?? false,
    fillColor: options.fillColor,
    fontSize: options.fontSize ?? 7,
    margin: [2, 3, 2, 3],
  };
}

function formatSarajevoDate(timestamp: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    timeZone: sarajevoTimeZone,
    year: "numeric",
  }).formatToParts(new Date(timestamp));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("day")}.${values.get("month")}.${values.get("year")}.`;
}

function sectionTitle(title: string): Content {
  return {
    table: {
      body: [[{
        text: title,
        bold: true,
        color: "#ffffff",
        fillColor: borderColor,
        fontSize: 8,
        margin: [5, 4, 5, 4],
      }]],
      widths: ["*"],
    },
    layout: "noBorders",
    margin: [0, 8, 0, 0],
  };
}

function blankBox(height: number): Content {
  return {
    table: {
      body: [[{ text: "", margin: [4, height, 4, 0] }]],
      widths: ["*"],
    },
    layout: {
      hLineColor: () => borderColor,
      hLineWidth: () => 0.7,
      vLineColor: () => borderColor,
      vLineWidth: () => 0.7,
    },
  };
}

export function buildWorkOrderPdfDefinition(
  snapshot: WorkOrderPdfSnapshot,
): TDocumentDefinitions {
  const documentDate = formatSarajevoDate(snapshot.workOrderCreatedAt);
  const materialHeader = [
    "R.BROJ",
    "KAT. BROJ",
    "OPIS",
    "JED. MJERE",
    "KOLIČINA",
    "JED. CIJENA",
    "UKUPNA CIJENA",
  ].map((heading) => textCell(heading, {
    alignment: "center",
    bold: true,
    fillColor: subtleFill,
    fontSize: 6.5,
  }));
  const materialRows = snapshot.materials.map((material) => [
    textCell(material.position, { alignment: "center" }),
    textCell(material.serialNumber, { alignment: "center" }),
    textCell(material.productName),
    textCell("", { alignment: "center" }),
    textCell(material.quantity, { alignment: "right", fontSize: 6 }),
    textCell("", { alignment: "right" }),
    textCell("", { alignment: "right" }),
  ]);
  const authoritativeDate = new Date(snapshot.workOrderCreatedAt);

  return {
    pageSize: "A4",
    pageOrientation: "portrait",
    pageMargins: [28, 28, 28, 38],
    info: {
      title: `Radni nalog ${snapshot.workOrderNumber}`,
      author: "Alfa Proteh",
      subject: "Radni nalog",
      creator: "AlfaEV trusted PDF generator",
      producer: "AlfaEV",
      creationDate: authoritativeDate,
      modDate: authoritativeDate,
    },
    defaultStyle: {
      font: "Roboto",
      fontSize: 8,
      color: "#111827",
      lineHeight: 1.1,
    },
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: "ALFA PROTEH • RADNI NALOG", color: "#667085", fontSize: 6 },
        {
          text: `Strana ${currentPage} / ${pageCount}`,
          alignment: "right",
          color: "#667085",
          fontSize: 6,
        },
      ],
      margin: [28, 8, 28, 0],
    }),
    content: [
      {
        columns: [
          {
            width: "*",
            stack: [
              { text: "ALFA", bold: true, color: brandRed, fontSize: 23 },
              { text: "PROTEH", bold: true, characterSpacing: 2.2, fontSize: 10 },
              {
                canvas: [{
                  type: "line",
                  x1: 0,
                  y1: 2,
                  x2: 112,
                  y2: 2,
                  lineWidth: 2,
                  lineColor: brandRed,
                }],
                margin: [0, 1, 0, 0],
              },
            ],
          },
          {
            width: 230,
            stack: [
              {
                text: "RADNI NALOG",
                alignment: "right",
                bold: true,
                fontSize: 19,
                characterSpacing: 1.2,
                margin: [0, 0, 0, 6],
              },
              {
                table: {
                  widths: [45, "*"],
                  body: [
                    [textCell("Broj", { bold: true }), textCell(snapshot.workOrderNumber)],
                    [textCell("Datum", { bold: true }), textCell(documentDate)],
                  ],
                },
                layout: {
                  hLineColor: () => borderColor,
                  hLineWidth: () => 0.7,
                  vLineColor: () => borderColor,
                  vLineWidth: () => 0.7,
                },
              },
            ],
          },
        ],
        columnGap: 18,
        margin: [0, 0, 0, 12],
      },
      {
        table: {
          widths: [72, "*"],
          body: [
            [textCell("PROJEKAT", { bold: true, fillColor: subtleFill }), textCell(snapshot.projectName)],
            [textCell("NARUČILAC", { bold: true, fillColor: subtleFill }), textCell(snapshot.customerName)],
            [textCell("DATUM", { bold: true, fillColor: subtleFill }), textCell(documentDate)],
          ],
        },
        layout: {
          hLineColor: () => borderColor,
          hLineWidth: () => 0.7,
          vLineColor: () => borderColor,
          vLineWidth: () => 0.7,
        },
      },
      sectionTitle("OPIS RADOVA"),
      {
        table: {
          widths: ["*"],
          body: [[{
            text: snapshot.description,
            margin: [5, 6, 5, 22],
          }]],
        },
        layout: {
          hLineColor: () => borderColor,
          hLineWidth: () => 0.7,
          vLineColor: () => borderColor,
          vLineWidth: () => 0.7,
        },
      },
      {
        table: {
          widths: [90, "*"],
          body: [[
            textCell("Ovlašteno lice", { bold: true, fillColor: subtleFill }),
            textCell(""),
          ]],
        },
        layout: {
          hLineColor: () => borderColor,
          hLineWidth: () => 0.7,
          vLineColor: () => borderColor,
          vLineWidth: () => 0.7,
        },
        margin: [0, 6, 0, 0],
      },
      sectionTitle("IZVJEŠTAJ O IZVRŠENIM RADOVIMA"),
      blankBox(46),
      sectionTitle("UTROŠAK MATERIJALA"),
      {
        table: {
          headerRows: 1,
          dontBreakRows: true,
          keepWithHeaderRows: 1,
          widths: [26, 54, 116, 42, 68, 52, 60],
          body: [materialHeader, ...materialRows],
        },
        layout: {
          hLineColor: () => borderColor,
          hLineWidth: () => 0.55,
          paddingBottom: () => 2,
          paddingLeft: () => 2,
          paddingRight: () => 2,
          paddingTop: () => 2,
          vLineColor: () => borderColor,
          vLineWidth: () => 0.55,
        },
      },
      {
        table: {
          widths: ["*", 96, 150],
          body: [[
            {
              text: "Datum završetka radova:\n\n____________________________",
              margin: [5, 8, 5, 8],
            },
            {
              text: "M.P.",
              alignment: "center",
              bold: true,
              margin: [5, 8, 5, 28],
            },
            {
              text: "Potpis ovlaštenog lica:\n\n____________________________",
              margin: [5, 8, 5, 8],
            },
          ]],
        },
        layout: {
          hLineColor: () => borderColor,
          hLineWidth: () => 0.7,
          vLineColor: () => borderColor,
          vLineWidth: () => 0.7,
        },
        margin: [0, 12, 0, 0],
        unbreakable: true,
      },
    ],
  };
}

/** Generate canonical bytes without browser DOM, Storage, or client state. */
export function generateWorkOrderPdf(
  snapshot: WorkOrderPdfSnapshot,
): Promise<Uint8Array> {
  const definition = buildWorkOrderPdfDefinition(snapshot);
  return new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf(
        definition,
        undefined,
        undefined,
        pdfFonts as unknown as Record<string, string>,
      ).getBuffer((buffer) => resolve(new Uint8Array(buffer)));
    } catch (error) {
      reject(error);
    }
  });
}
