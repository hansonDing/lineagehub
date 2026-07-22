/**
 * 集成设置(/settings)— 仅 System Owner
 * 三张卡片:Azure DevOps 集成(含 Webhook 说明 + 测试连接)/ SMTP 邮件通知(含测试邮件)/ 用户邮箱
 * 进入页面拉取 GET /settings/integrations;保存走 PUT(pat/password/webhook_secret 空串 = 保持不变)
 */

import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import type { IntegrationSettings } from '@/lib/api'
import {
  ApiError,
  getIntegrationSettings,
  testAdo,
  testSmtp,
  updateIntegrationSettings,
} from '@/lib/api'
import { useT } from '@/lib/i18n'
import { useUser } from '@/hooks/useUser'
import { EmptyState } from '@/components/common/EmptyState'
import { toast } from '@/components/common/Toast'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { FieldLabel, TextInput } from '@/components/metadata/controls'

// ---------- 通用小部件 ----------

function Card({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
        <p className="mt-0.5 text-xs text-slate-500">{desc}</p>
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  )
}

function EnabledRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-2.5">
      <Switch checked={checked} onCheckedChange={onChange} />
      <span className="text-[13px] font-medium text-slate-700">{label}</span>
    </div>
  )
}

/** 加载骨架:三个卡片占位 */
function SettingsSkeleton() {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="h-4 w-40 animate-pulse rounded bg-slate-100" />
          <div className="mt-2 h-3 w-72 animate-pulse rounded bg-slate-100" />
          <div className="mt-5 space-y-3">
            <div className="h-8 animate-pulse rounded bg-slate-100" />
            <div className="h-8 animate-pulse rounded bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------- 页面 ----------

export default function Settings() {
  const { t } = useT()
  const { role } = useUser()
  const isOwner = role === 'System Owner'

  const [settings, setSettings] = useState<IntegrationSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testingAdo, setTestingAdo] = useState(false)
  const [testingSmtp, setTestingSmtp] = useState(false)
  const [testTo, setTestTo] = useState('')

  useEffect(() => {
    if (!isOwner) return
    let cancelled = false
    getIntegrationSettings()
      .then((s) => {
        if (!cancelled) setSettings(s)
      })
      .catch((err) => {
        toast.error(t('settings.save.fail'), err instanceof Error ? err.message : undefined)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner])

  if (!isOwner) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white">
        <EmptyState title={t('settings.forbidden.title')} description={t('settings.forbidden.desc')} className="py-20" />
      </div>
    )
  }

  const patchAdo = (patch: Partial<IntegrationSettings['ado']>) =>
    setSettings((s) => (s ? { ...s, ado: { ...s.ado, ...patch } } : s))
  const patchSmtp = (patch: Partial<IntegrationSettings['smtp']>) =>
    setSettings((s) => (s ? { ...s, smtp: { ...s.smtp, ...patch } } : s))
  const patchEmail = (name: string, email: string) =>
    setSettings((s) =>
      s ? { ...s, emails: s.emails.map((e) => (e.name === name ? { ...e, email } : e)) } : s,
    )

  const handleSave = async () => {
    if (!settings) return
    setSaving(true)
    try {
      const saved = await updateIntegrationSettings(settings)
      // 回包剥离密钥明文,用回包覆盖本地态(*_set 标记同步)
      setSettings(saved)
      toast.success(t('settings.save.ok'), t('settings.save.okDesc'))
    } catch (err) {
      toast.error(t('settings.save.fail'), err instanceof Error ? err.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  const handleTestAdo = async () => {
    setTestingAdo(true)
    try {
      const res = await testAdo()
      toast.success(t('settings.ado.test.ok'), res.detail)
    } catch (err) {
      const detail =
        err instanceof ApiError || err instanceof Error ? err.message : ''
      toast.error(t('settings.ado.test.fail'), detail)
    } finally {
      setTestingAdo(false)
    }
  }

  const handleTestSmtp = async () => {
    setTestingSmtp(true)
    try {
      const res = await testSmtp(testTo.trim())
      toast.success(t('settings.smtp.test.ok'), res.detail)
    } catch (err) {
      const detail =
        err instanceof ApiError || err instanceof Error ? err.message : ''
      toast.error(t('settings.smtp.test.fail'), detail)
    } finally {
      setTestingSmtp(false)
    }
  }

  const webhookUrl = `${window.location.origin}/api/webhooks/ado?secret=xxx`

  return (
    <div>
      {/* 页面头 */}
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold leading-7 text-slate-900">{t('settings.title')}</h1>
        <p className="text-xs text-slate-500">{t('settings.subtitle')}</p>
      </div>

      {loading || !settings ? (
        <SettingsSkeleton />
      ) : (
        <div className="space-y-4">
          {/* Azure DevOps 集成 */}
          <Card title={t('settings.ado.title')} desc={t('settings.ado.desc')}>
            <div className="space-y-4">
              <EnabledRow
                label={t('settings.enabled')}
                checked={settings.ado.enabled}
                onChange={(v) => patchAdo({ enabled: v })}
              />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Field label={t('settings.ado.orgUrl')}>
                  <TextInput
                    mono
                    value={settings.ado.org_url}
                    placeholder={t('settings.ado.orgUrlPlaceholder')}
                    onChange={(e) => patchAdo({ org_url: e.target.value })}
                  />
                </Field>
                <Field label={t('settings.ado.project')}>
                  <TextInput
                    value={settings.ado.project}
                    onChange={(e) => patchAdo({ project: e.target.value })}
                  />
                </Field>
                <Field label={t('settings.ado.repo')}>
                  <TextInput
                    value={settings.ado.repo}
                    onChange={(e) => patchAdo({ repo: e.target.value })}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label={t('settings.ado.pat')}>
                  <TextInput
                    type="password"
                    value={settings.ado.pat ?? ''}
                    placeholder={
                      settings.ado.pat_set ? t('settings.secret.saved') : t('settings.ado.patPlaceholder')
                    }
                    onChange={(e) => patchAdo({ pat: e.target.value })}
                  />
                </Field>
                <Field label={t('settings.ado.webhookSecret')}>
                  <TextInput
                    type="password"
                    value={settings.ado.webhook_secret ?? ''}
                    placeholder={
                      settings.ado.webhook_secret_set
                        ? t('settings.secret.saved')
                        : t('settings.ado.webhookSecretPlaceholder')
                    }
                    onChange={(e) => patchAdo({ webhook_secret: e.target.value })}
                  />
                </Field>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="secondary" size="sm" onClick={() => void handleTestAdo()} disabled={testingAdo}>
                  {testingAdo ? t('settings.ado.testing') : t('settings.ado.test')}
                </Button>
              </div>
              <p className="rounded-md bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
                {t('settings.ado.hookHint', { url: webhookUrl })}
              </p>
            </div>
          </Card>

          {/* SMTP 邮件通知 */}
          <Card title={t('settings.smtp.title')} desc={t('settings.smtp.desc')}>
            <div className="space-y-4">
              <EnabledRow
                label={t('settings.enabled')}
                checked={settings.smtp.enabled}
                onChange={(v) => patchSmtp({ enabled: v })}
              />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="md:col-span-2">
                  <Field label={t('settings.smtp.host')}>
                    <TextInput
                      mono
                      value={settings.smtp.host}
                      placeholder={t('settings.smtp.hostPlaceholder')}
                      onChange={(e) => patchSmtp({ host: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label={t('settings.smtp.port')}>
                  <TextInput
                    type="number"
                    value={String(settings.smtp.port)}
                    onChange={(e) => patchSmtp({ port: Number(e.target.value) || 465 })}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label={t('settings.smtp.username')}>
                  <TextInput
                    value={settings.smtp.username}
                    onChange={(e) => patchSmtp({ username: e.target.value })}
                  />
                </Field>
                <Field label={t('settings.smtp.password')}>
                  <TextInput
                    type="password"
                    value={settings.smtp.password ?? ''}
                    placeholder={
                      settings.smtp.password_set
                        ? t('settings.secret.saved')
                        : t('settings.smtp.passwordPlaceholder')
                    }
                    onChange={(e) => patchSmtp({ password: e.target.value })}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-1 items-end gap-4 md:grid-cols-2">
                <Field label={t('settings.smtp.fromAddr')}>
                  <TextInput
                    mono
                    value={settings.smtp.from_addr}
                    placeholder={t('settings.smtp.fromAddrPlaceholder')}
                    onChange={(e) => patchSmtp({ from_addr: e.target.value })}
                  />
                </Field>
                <div className="pb-1">
                  <EnabledRow
                    label={t('settings.smtp.useTls')}
                    checked={settings.smtp.use_tls}
                    onChange={(v) => patchSmtp({ use_tls: v })}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-full sm:w-72">
                  <Field label={t('settings.smtp.testTo')}>
                    <TextInput
                      mono
                      value={testTo}
                      placeholder={t('settings.smtp.testToPlaceholder')}
                      onChange={(e) => setTestTo(e.target.value)}
                    />
                  </Field>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleTestSmtp()}
                  disabled={testingSmtp || !testTo.trim()}
                  className="mb-0.5"
                >
                  {testingSmtp ? t('settings.smtp.testing') : t('settings.smtp.test')}
                </Button>
              </div>
            </div>
          </Card>

          {/* 用户邮箱 */}
          <Card title={t('settings.emails.title')} desc={t('settings.emails.desc')}>
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 text-left">
                  <th className="pb-2 text-xs font-medium text-slate-500">{t('settings.emails.name')}</th>
                  <th className="pb-2 text-xs font-medium text-slate-500">{t('settings.emails.email')}</th>
                </tr>
              </thead>
              <tbody>
                {settings.emails.map((row) => (
                  <tr key={row.name} className="border-b border-slate-50 last:border-0">
                    <td className="py-2 pr-4 text-[13px] font-medium text-slate-900">{row.name}</td>
                    <td className="py-2">
                      <TextInput
                        mono
                        value={row.email}
                        onChange={(e) => patchEmail(row.name, e.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* 底部保存 */}
          <div className="flex justify-end">
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? t('settings.saving') : t('settings.save')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
