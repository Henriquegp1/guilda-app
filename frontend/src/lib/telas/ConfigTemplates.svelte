<script lang="ts">
	import { salvarEventoAnuncio, testarEventoAnuncio, ErroApi } from '$lib/api';

	let { events }: { events: any[] } = $props();

	let abaAberta = $state<string | null>(null);
	let ocupado = $state<string | null>(null);
	let statusMsg = $state<Record<string, { texto: string; tipo: 'ok' | 'erro' }>>({});

	// Dados fictícios para o preview
	const fixtures: Record<string, any> = {
		guilda: 'Ordem Carmesim',
		tag: 'ORDM',
		lider: 'Foyth',
		nivel: 7,
		prestigio: '14.520',
		membros: 18,
		canal: 'streamer',
		nivel_anterior: 6,
		desbloqueio: 'Emblema animado',
		oponente: 'Eclipse',
		tag_oponente: 'ECL',
		duracao: '48 h',
		vencedor: 'Ordem Carmesim',
		placar: '3 x 1',
		territorio: 'Vale Sombrio',
		conquista: 'Primeiro Sangue',
		raridade: 'legendary',
		temporada: 'Temporada 3',
		termina_em: '30/09',
		primeiro: 'Ordem Carmesim',
		segundo: 'Eclipse',
		terceiro: 'Void',
		vagas: 4,
		modo: 'aberta',
		quantidade: 10,
		lista: 'Ordem Carmesim, Eclipse, Void e mais 7'
	};

	function renderPreview(template: string | null, fallback: string) {
		const t = template || fallback;
		return t.replace(/\{(\w+)\}/g, (match, key) => {
			return fixtures[key] !== undefined ? fixtures[key] : match;
		});
	}

	async function salvar(ev: any) {
		ocupado = ev.event_type;
		statusMsg[ev.event_type] = { texto: '', tipo: 'ok' };
		try {
			await salvarEventoAnuncio(ev.event_type, {
				enabled: ev.enabled,
				template: ev.template,
				template_agg: ev.template_agg,
				cooldown_s: ev.cooldown_s
			});
			statusMsg[ev.event_type] = { texto: 'Salvo!', tipo: 'ok' };
		} catch (e) {
			statusMsg[ev.event_type] = {
				texto: e instanceof ErroApi ? e.message : 'Erro ao salvar.',
				tipo: 'erro'
			};
		} finally {
			ocupado = null;
		}
	}

	let mensagem = $state('');

	async function testar(type: string) {
		ocupado = type + '-test';
		mensagem = '';
		try {
			await testarEventoAnuncio(type);
			mensagem = 'Teste disparado! Verifique seu chat.';
		} catch (e) {
			mensagem = e instanceof ErroApi ? e.message : 'Erro ao disparar teste.';
		} finally {
			ocupado = null;
		}
	}

	const labelEvento = (t: string) => t.replace('.', ' ').toUpperCase();
</script>

<div class="config-templates">
	<div class="header-sec">
		<h3>Eventos & Templates</h3>
		<p class="ajuda">Personalize as mensagens que seu bot enviará para o chat.</p>
	</div>

	{#if !events || events.length === 0}
		<p class="vazio">Nenhum evento configurável encontrado.</p>
	{:else}
		<div class="accordion">
			{#each events as ev (ev.event_type)}
				<div class="item" class:aberto={abaAberta === ev.event_type}>
					<button class="trigger" onclick={() => (abaAberta = abaAberta === ev.event_type ? null : ev.event_type)}>
						<div class="resumo">
							<span class="status-dot" class:on={ev.enabled}></span>
							<span class="nome">{labelEvento(ev.event_type)}</span>
							<span class="prioridade {ev.priority}">{ev.priority}</span>
						</div>
						<span class="seta">{abaAberta === ev.event_type ? '▲' : '▼'}</span>
					</button>

					{#if abaAberta === ev.event_type}
						<div class="conteudo">
							<div class="controles-topo">
								<label class="switch-label">
									<input type="checkbox" bind:checked={ev.enabled} />
									Habilitar este anúncio
								</label>
								<div class="field cooldown">
									<label for="cooldown-{ev.event_type}">Cooldown (segundos)</label>
									<input id="cooldown-{ev.event_type}" type="number" bind:value={ev.cooldown_s} min="30" max="86400" />
								</div>
							</div>

							<div class="field">
								<label for="template-{ev.event_type}">Mensagem Individual</label>
								<div class="input-container">
									<textarea
										id="template-{ev.event_type}"
										maxlength="300"
										placeholder={ev.default_template}
										bind:value={ev.template}
									></textarea>
									<span class="char-count" class:perto={(ev.template?.length || 0) > 280}>
										{ev.template?.length || 0}/300
									</span>
								</div>
								<div class="preview">
									<small>PREVIEW:</small>
									<p>{renderPreview(ev.template, ev.default_template)}</p>
								</div>
							</div>

							{#if ev.default_template_agg}
								<div class="field">
									<label for="template-agg-{ev.event_type}">Mensagem Agregada (3+ eventos)</label>
									<div class="input-container">
										<textarea
											id="template-agg-{ev.event_type}"
											maxlength="300"
											placeholder={ev.default_template_agg}
											bind:value={ev.template_agg}
										></textarea>
										<span class="char-count" class:perto={(ev.template_agg?.length || 0) > 280}>
											{ev.template_agg?.length || 0}/300
										</span>
									</div>
									<div class="preview">
										<small>PREVIEW:</small>
										<p>{renderPreview(ev.template_agg, ev.default_template_agg)}</p>
									</div>
								</div>
							{/if}

							<div class="acoes-item">
								<button class="btn-salvar" disabled={ocupado === ev.event_type} onclick={() => salvar(ev)}>
									{ocupado === ev.event_type ? 'Salvando...' : 'Salvar Mudanças'}
								</button>
								<button class="btn-testar" disabled={ocupado?.includes('test')} onclick={() => testar(ev.event_type)}>
									🧪 Testar no Chat
								</button>
								{#if statusMsg[ev.event_type]}
									<span class="status {statusMsg[ev.event_type].tipo}">
										{statusMsg[ev.event_type].texto}
									</span>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.config-templates {
		margin-top: 14px;
	}

	h3 { font-size: 16px; margin-bottom: 4px; color: var(--or); }
	.ajuda { font-size: 12px; color: var(--argent-fraco); margin-bottom: 16px; }

	.accordion {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.item {
		background: var(--sable-2);
		border: 1px solid var(--borda);
		border-radius: 4px;
		overflow: hidden;
	}

	.trigger {
		width: 100%;
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 12px 16px;
		background: none;
		border: none;
		cursor: pointer;
		min-height: auto;
	}

	.trigger:hover { background: rgba(255, 255, 255, 0.02); }

	.resumo { display: flex; align-items: center; gap: 12px; }

	.status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--sable-3);
		border: 1px solid var(--borda);
	}
	.status-dot.on { background: var(--vert); border-color: var(--vert); }

	.nome { font-size: 13px; font-weight: bold; color: var(--argent); }

	.prioridade {
		font-size: 9px;
		text-transform: uppercase;
		padding: 1px 4px;
		border-radius: 2px;
		background: var(--sable-3);
		color: var(--argent-fraco);
	}
	.prioridade.alta { color: #ff5252; background: rgba(255, 82, 82, 0.1); }

	.conteudo {
		padding: 16px;
		border-top: 1px solid var(--borda);
		background: var(--sable);
	}

	.controles-topo {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 20px;
	}

	.switch-label {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		cursor: pointer;
	}

	.field { margin-bottom: 16px; }
	.field label {
		display: block;
		font-size: 11px;
		text-transform: uppercase;
		color: var(--argent-fraco);
		margin-bottom: 6px;
		letter-spacing: 0.05em;
	}

	.input-container { position: relative; }

	textarea {
		width: 100%;
		background: var(--sable-2);
		border: 1px solid var(--borda);
		color: var(--argent);
		padding: 10px;
		font-size: 13px;
		line-height: 1.4;
		border-radius: 2px;
		height: 60px;
		resize: vertical;
	}
	textarea:focus { border-color: var(--or); outline: none; }

	.char-count {
		position: absolute;
		bottom: 6px;
		right: 8px;
		font-size: 10px;
		color: var(--argent-fraco);
	}
	.char-count.perto { color: var(--or); }

	.preview {
		margin-top: 8px;
		padding: 10px;
		background: rgba(255, 255, 255, 0.03);
		border-radius: 2px;
	}
	.preview small { font-size: 9px; color: var(--argent-fraco); font-weight: bold; }
	.preview p { margin: 4px 0 0; font-size: 13px; color: #fff; }

	.cooldown input {
		background: var(--sable-2);
		border: 1px solid var(--borda);
		color: var(--argent);
		padding: 6px;
		width: 100px;
		font-size: 13px;
	}

	.acoes-item { display: flex; align-items: center; gap: 12px; margin-top: 24px; }

	.btn-salvar { background: var(--or); color: var(--sable); font-weight: bold; border: none; }
	.btn-testar { background: none; border-color: var(--argent-fraco); font-size: 11px; color: var(--argent-fraco); }
	.btn-testar:hover { border-color: var(--or); color: var(--or); }

	.status { font-size: 12px; }
	.status.ok { color: var(--vert); }
	.status.erro { color: var(--gules); }

	.vazio { text-align: center; padding: 20px; color: var(--argent-fraco); font-style: italic; }
</style>
