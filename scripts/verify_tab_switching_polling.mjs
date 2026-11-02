import { chromium } from 'playwright';

async function main() {
  console.log('Launching browser to verify Tab Switching & Retained Polling...');
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  console.log('Navigating to http://localhost:5173...');
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });

  // 1. Open the Upgrade Modal by clicking "Gói PRO" in header or sidebar
  console.log('Opening modal via Pro button...');
  const proBtn = page.locator('button:has-text("Nâng cấp PRO"), button:has-text("PRO")').first();
  await proBtn.click();
  await page.waitForTimeout(500);

  // 2. Read sessionCode from PRO tab
  const proCodeEl = page.locator('span:text-matches("SEVQR[A-Z0-9]{5}")').first();
  await proCodeEl.waitFor({ state: 'visible', timeout: 5000 });
  const proCode = await proCodeEl.textContent();
  console.log('PRO Tab Payment Code:', proCode);

  // 3. Switch to "Ủng hộ Dev & Liên hệ" tab
  console.log('Switching to "Ủng hộ Dev & Liên hệ" tab...');
  const donateTabBtn = page.locator('button:has-text("Ủng hộ Dev & Liên hệ")');
  await donateTabBtn.click();
  await page.waitForTimeout(600);

  // 4. Verify code on Donate tab is IDENTICAL
  const donateCodeEl = page.locator('span:text-matches("SEVQR[A-Z0-9]{5}")').first();
  await donateCodeEl.waitFor({ state: 'visible', timeout: 5000 });
  const donateCode = await donateCodeEl.textContent();
  console.log('Donate Tab Payment Code:', donateCode);

  if (proCode.trim() !== donateCode.trim()) {
    throw new Error(`Codes do not match! PRO: "${proCode}", Donate: "${donateCode}"`);
  }
  console.log('✓ Success: Payment session code is PERSISTED across tab switches!');

  // 5. Verify listening indicator and manual check button are visible on Donate tab
  const listeningIndicator = page.locator('text=Đang lắng nghe thanh toán tự động (3s)...');
  await listeningIndicator.waitFor({ state: 'visible', timeout: 3000 });
  console.log('✓ Success: Real-time listening indicator (3s) is visible on Donate tab!');

  const manualCheckBtn = page.locator('button[data-testid="donate-manual-check-btn"]');
  await manualCheckBtn.waitFor({ state: 'visible', timeout: 3000 });
  console.log('✓ Success: Manual check button is visible on Donate tab!');

  // Capture screenshot of Donate Tab in PENDING state
  const pendingScreenshotPath = 'C:/Users/Nguyen Dang Khanh/.gemini/antigravity/brain/b2666aca-d544-4d60-8f3a-7d62c3d4076c/tab_switch_donate_pending.png';
  await page.screenshot({ path: pendingScreenshotPath });
  console.log('Saved screenshot:', pendingScreenshotPath);

  // 6. Switch back to PRO tab and verify code is STILL identical
  console.log('Switching back to PRO tab...');
  const proTabBtn = page.locator('button:has-text("Gói PRO 5.000đ")');
  await proTabBtn.click();
  await page.waitForTimeout(500);

  const proCodeAgainEl = page.locator('span:text-matches("SEVQR[A-Z0-9]{5}")').first();
  const proCodeAgain = await proCodeAgainEl.textContent();
  console.log('PRO Tab Payment Code on return:', proCodeAgain);
  if (proCode.trim() !== proCodeAgain.trim()) {
    throw new Error(`Code changed after returning to PRO! Expected: "${proCode}", Got: "${proCodeAgain}"`);
  }
  console.log('✓ Success: Payment session code preserved even when toggling back and forth!');

  // 7. Simulate payment and verify automatic transition to Celebration screen on Donate tab
  console.log('Simulating payment for code:', proCode.trim());

  // Switch back to Donate tab
  await donateTabBtn.click();
  await page.waitForTimeout(300);

  // Route /api/payment/status* to return paid: true with amount 50000
  await page.route('**/api/payment/status**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        paid: true,
        status: 'PAID',
        code: proCode.trim(),
        amount: 50000,
        licenseKey: proCode.trim(),
        donorName: 'Người bạn đồng hành',
      }),
    });
  });

  // Trigger manual check or wait for 3s polling
  console.log('Triggering manual check button on Donate tab...');
  await manualCheckBtn.click();

  // Wait for Celebration screen elements
  console.log('Waiting for Celebration Screen to render...');
  const celebrationHeader = page.locator('text=Cảm Ơn Tấm Lòng Của Bạn! ❤️');
  await celebrationHeader.waitFor({ state: 'visible', timeout: 5000 });
  console.log('✓ Success: Celebration screen rendered with "Cảm Ơn Tấm Lòng Của Bạn! ❤️"');

  const donorNameForm = page.locator('form input[placeholder="Nhập tên bạn muốn ghi danh..."]');
  await donorNameForm.waitFor({ state: 'visible', timeout: 3000 });
  console.log('✓ Success: Donor Name Immortalization form is visible!');

  // Capture screenshot of Celebration Screen
  const celebrationScreenshotPath = 'C:/Users/Nguyen Dang Khanh/.gemini/antigravity/brain/b2666aca-d544-4d60-8f3a-7d62c3d4076c/tab_switch_donate_celebration.png';
  await page.screenshot({ path: celebrationScreenshotPath });
  console.log('Saved screenshot:', celebrationScreenshotPath);

  await browser.close();
  console.log('All Tab Switching & Polling checks passed successfully!');
}

main().catch((err) => {
  console.error('Playwright verification error:', err);
  process.exit(1);
});
