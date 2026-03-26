import { test, expect } from '@playwright/test'

test.describe('Neptune Inspector Page Verification', () => {
  const baseURL = 'http://127.0.0.1:5188'

  test('should render the Clients page correctly', async ({ page }) => {
    await page.goto(baseURL)
    await expect(page.locator('h1')).toHaveText('客户端列表')
    await expect(page.getByText('Neptune Inspector')).toBeVisible()
    await expect(page.getByLabel('gateway-base-url')).toBeVisible()
  })

  test('should render the Client Detail page correctly', async ({ page }) => {
    const clientId = 'WyJpb3MiLCJjb20ubmVwdHVuZWtpdC5kZW1vLmlvcyIsInNpbXVsYXRvci1zZXNzaW9uIiwiMEE5QzYxNEUtMURDOS00QjBGLUFCODAtMTE0NDhFQUU3MDhFIl0'
    await page.goto(`${baseURL}/clients/${clientId}`)
    await expect(page.locator('h1')).toContainText('ios · com.neptunekit.demo.ios')
    await expect(page.getByText('session=simulator-session')).toBeVisible()
    await expect(page.getByRole('link', { name: '返回首页' })).toBeVisible()
  })
})
