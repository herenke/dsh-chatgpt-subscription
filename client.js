window.__ModuleLoader__.load({
  id: 'dsh-chatgpt-subscription',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'dsh-chatgpt-subscription';
    const ENTRY = 'chatgpt-subscription';
    const copy = {
      zh: {
        title: 'ChatGPT 订阅',
        hint: '通过官方 Sign in with ChatGPT 使用订阅额度。禁用后对话的模型选择器不再加载该 provider（api.openai.com 需要可用的网络代理）。',
        enabled: '已启用',
        disabled: '已禁用',
        enable: '启用',
        disable: '禁用',
        saving: '保存中…',
        unavailable: '设置暂不可用',
        failed: '设置未保存，请重试。',
        refresh: '切换后重新打开模型选择器以刷新列表；正在使用该模型的会话需要改选模型。',
      },
      en: {
        title: 'ChatGPT subscription',
        hint: 'Uses your ChatGPT plan through official Sign in with ChatGPT. While disabled, the chat model picker no longer loads this provider (api.openai.com needs a working network proxy).',
        enabled: 'Enabled',
        disabled: 'Disabled',
        enable: 'Enable',
        disable: 'Disable',
        saving: 'Saving…',
        unavailable: 'Settings unavailable',
        failed: 'Settings were not saved. Try again.',
        refresh: 'Reopen the model picker after switching; a session using this model must pick another one.',
      },
    };
    return {
      inject: ['slots', 'locale', 'configForms'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, copy), 'chatgpt-subscription: copy');
        const t = ctx.locale.bind(NS);
        const form = ctx.configForms.get(ENTRY);
        const muted = { margin: 0, fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary, #8c8c8c)' };
        function Card() {
          const [snapshot, setSnapshot] = React.useState(() => form.getSnapshot());
          const [busy, setBusy] = React.useState(false);
          const [failed, setFailed] = React.useState(false);
          React.useEffect(() => form.subscribe(() => setSnapshot(form.getSnapshot())), []);
          const value = snapshot.value ?? {};
          const enabled = value.enabled !== false;
          const writable = snapshot.writable === true && snapshot.status === 'ready';
          const toggle = async () => {
            if (busy || !writable) return;
            setBusy(true);
            setFailed(false);
            try {
              if (!(await form.set('enabled', !enabled))) setFailed(true);
            } catch {
              setFailed(true);
            } finally {
              setBusy(false);
            }
          };
          return h('div', {
            style: {
              border: '0.5px solid var(--dsw-alias-settings-card-stroke, #e5e5e5)',
              background: 'var(--dsw-alias-settings-card-fill, transparent)',
              borderRadius: '12px',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              color: 'var(--dsw-alias-label-primary, #1f1f1f)',
            },
          }, [
            h('div', { key: 'head', style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
              h('span', { key: 'name', style: { fontSize: '14px', fontWeight: 500 } }, t('title')),
              h('span', {
                key: 'state',
                style: {
                  fontSize: '12px',
                  padding: '1px 8px',
                  borderRadius: '999px',
                  border: '0.5px solid var(--dsw-alias-border-l3, #d9d9d9)',
                  color: enabled
                    ? 'var(--dsw-alias-state-success-primary, #1a7f37)'
                    : 'var(--dsw-alias-label-tertiary, #8c8c8c)',
                },
              }, enabled ? t('enabled') : t('disabled')),
              h('button', {
                key: 'switch',
                type: 'button',
                role: 'switch',
                'aria-checked': enabled,
                'aria-label': t('title'),
                disabled: busy || !writable,
                onClick: toggle,
                style: {
                  marginLeft: 'auto',
                  cursor: busy || !writable ? 'default' : 'pointer',
                  opacity: busy || !writable ? 0.5 : 1,
                  border: '0.5px solid var(--dsw-alias-border-l3, #d9d9d9)',
                  background: enabled ? 'var(--dsw-alias-state-business-primary, #1677ff)' : 'transparent',
                  color: enabled ? '#fff' : 'var(--dsw-alias-label-primary, #1f1f1f)',
                  borderRadius: '999px',
                  padding: '4px 12px',
                  fontSize: '12px',
                  lineHeight: '18px',
                },
              }, busy ? t('saving') : enabled ? t('disable') : t('enable')),
            ]),
            h('p', { key: 'hint', style: muted }, t('hint')),
            snapshot.status === 'ready' ? h('p', { key: 'refresh', style: muted }, t('refresh')) : null,
            snapshot.status === 'unavailable' ? h('p', { key: 'unavailable', style: { ...muted, color: 'var(--dsw-alias-state-warn-label, #ad6800)' } }, t('unavailable')) : null,
            failed ? h('p', { key: 'failed', style: { ...muted, color: 'var(--dsw-alias-state-error-primary, #cf1322)' } }, t('failed')) : null,
          ]);
        }
        ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
          name: 'settings.models.footer',
          id: 'chatgpt-subscription',
          order: 10,
          label: t('title'),
        }, Card));
      },
    };
  },
});
