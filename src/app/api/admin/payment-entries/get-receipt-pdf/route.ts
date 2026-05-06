import puppeteer from "puppeteer";
import { buildReceiptHTML, ReceiptData } from "@/utils/buildReceiptHTML";
import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
	const data: ReceiptData = await req.json();

	const browser = await puppeteer.launch();
	const page = await browser.newPage();

	const html = buildReceiptHTML(data);

	await page.setContent(html, {
		waitUntil: "domcontentloaded",
	});

	const pdf = await page.pdf({
		format: "A4",
		printBackground: true,
		margin: {
			top: "10mm",
			bottom: "10mm",
			left: "10mm",
			right: "10mm",
		},
	});

	await browser.close();

	return new Response(Buffer.from(pdf), {
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": "attachment; filename=receipt.pdf",
		},
	});
}
