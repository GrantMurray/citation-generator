// Fills the violation-notice PDF template. Shared by the web app and tests.
// `values` maps PDF field names to strings (text fields), booleans
// (checkboxes), or an export value (the "Pictures Attached" radio group).
// "Description of Violation" is special: it is wrapped across the form's
// three ruled "Description Line N" fields, shrinking the text if needed.
(function (root) {
  const DESC_LINES = ["Description Line 1", "Description Line 2", "Description Line 3"];
  const MIN_DESC_SIZE = 3.5;

  function wrap(text, font, size, width) {
    const lines = [];
    for (const para of text.split(/\r?\n/)) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? line + " " + word : word;
        if (line && font.widthOfTextAtSize(next, size) > width) {
          lines.push(line);
          line = word;
        } else {
          line = next;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  function fillDescription(form, font, text) {
    const fields = DESC_LINES.map((n) => form.getTextField(n));
    const widget = fields[0].acroField.getWidgets()[0];
    const width = widget.getRectangle().width - 4;
    const da = fields[0].acroField.getDefaultAppearance() || "";
    let size = parseFloat((da.match(/([\d.]+)\s+Tf/) || [])[1]) || 6;

    let lines = wrap(text, font, size, width);
    while (lines.length > fields.length && size > MIN_DESC_SIZE) {
      size = Math.max(MIN_DESC_SIZE, size - 0.25);
      lines = wrap(text, font, size, width);
    }
    if (lines.length > fields.length) {
      lines = lines.slice(0, fields.length - 1).concat(lines.slice(fields.length - 1).join(" "));
    }
    fields.forEach((f, i) => {
      f.setFontSize(size);
      f.setText(lines[i] || "");
    });
  }

  async function fillCitation(PDFLib, templateBytes, values) {
    const pdf = await PDFLib.PDFDocument.load(templateBytes);
    const form = pdf.getForm();
    const helvetica = await pdf.embedFont(PDFLib.StandardFonts.Helvetica);

    for (const field of form.getFields()) {
      const name = field.getName();
      if (!(name in values)) continue;
      const v = values[name];
      if (field instanceof PDFLib.PDFTextField) {
        field.setText(v ? String(v) : "");
      } else if (field instanceof PDFLib.PDFCheckBox) {
        v ? field.check() : field.uncheck();
      } else if (field instanceof PDFLib.PDFRadioGroup) {
        v ? field.select(v) : field.clear();
      }
    }
    if ("Description of Violation" in values) {
      fillDescription(form, helvetica, values["Description of Violation"] || "");
    }

    form.updateFieldAppearances(helvetica);
    return pdf.save();
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { fillCitation };
  else root.fillCitation = fillCitation;
})(this);
