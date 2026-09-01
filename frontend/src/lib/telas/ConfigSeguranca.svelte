<script lang="ts">
	import { rotacionarSegredoAnuncio, ErroApi } from '$lib/api';

	let novoSegredo = $state<string | null>(null);
	let expiraEm = $state<string | null>(null);
	let erro = $state('');
	let carregando = $state(false);
	let mostrarConfirmacao = $state(false);

	async function rotacionar() {
		erro = '';
		carregando = true;
		try {
			const res = await rotacionarSegredoAnuncio();
			novoSegredo = res.secret;
			expiraEm = res.retires_at;
			mostrarConfirmacao = false;
		} catch (e) {
			erro = e instanceof ErroApi ? e.message : 'Erro ao rotacionar segredo.';
		} finally {
			carregando = false;
		}
	}

	function copiar() {
		if (novoSegredo) {
			navigator.clipboard.writeText(novoSegredo);
			alert('Copiado para a área de transferência!');
		}
	}
</script>

<div class="config-seguranca">
	<div class="header-sec">
		<h3>Segurança HMAC</h3>
		<p class="ajuda">
			O segredo é usado para assinar as mensagens enviadas ao seu bot. Isso garante que ninguém
			além da extensão possa enviar anúncios falsos para o seu chat.
		</p>
	</div>

	{#if novoSegredo}
		<div class="alerta-sucesso">
			<p><b>Novo segredo gerado com sucesso!</b></p>
			<p class="aviso-critico">
				⚠️ Copie agora. Por segurança, ele não será exibido novamente após você sair desta página.
			</p>
			<div class="area-copia">
				<code>{novoSegredo}</code>
				<button class="btn-copiar" onclick={copiar}>Copiar</button>
			</div>
			<p class="nota">
				O segredo antigo continuará funcionando até {new Date(expiraEm!).toLocaleString('pt-BR')} para dar tempo de você atualizar seu bot.
			</p>
			<button class="btn-voltar" onclick={() => (novoSegredo = null)}>Entendi, pode fechar</button>
		</div>
	{:else}
		<div class="estado-atual">
			<div class="info">
				<span class="status-badge ativo">Ativo</span>
				<span class="label">Assinatura HMAC-SHA256 habilitada</span>
			</div>
			<button class="btn-rotacionar" onclick={() => (mostrarConfirmacao = true)}>
				🔄 Gerar Novo Segredo
			</button>
		</div>
	{/if}

	{#if erro}<p class="msg-erro">{erro}</p>{/if}

	{#if mostrarConfirmacao}
		<div class="modal-overlay">
			<div class="modal">
				<h4>Confirmar Rotação?</h4>
				<p>
					Ao gerar um novo segredo, o atual entrará em período de expiração (24h). Você precisará
					atualizar a configuração do seu bot com a nova chave.
				</p>
				<div class="modal-acoes">
					<button class="btn-cancelar" onclick={() => (mostrarConfirmacao = false)}>Cancelar</button>
					<button class="btn-confirmar" disabled={carregando} onclick={rotacionar}>
						{carregando ? 'Gerando...' : 'Sim, Gerar Novo'}
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.config-seguranca {
		background: var(--sable-2);
		border: 1px solid var(--borda);
		padding: 16px;
		border-radius: 4px;
	}

	h3 {
		font-size: 16px;
		margin-bottom: 8px;
		color: var(--or);
	}

	.ajuda {
		font-size: 12px;
		color: var(--argent-fraco);
		margin-bottom: 16px;
		line-height: 1.4;
	}

	.estado-atual {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 12px;
		background: var(--sable);
		border-radius: 2px;
	}

	.status-badge {
		font-size: 10px;
		text-transform: uppercase;
		font-weight: bold;
		padding: 2px 6px;
		border-radius: 10px;
		background: var(--vert);
		color: white;
		margin-right: 8px;
	}

	.label {
		font-size: 13px;
	}

	.btn-rotacionar {
		font-size: 12px;
		padding: 6px 12px;
		min-height: 32px;
		border-color: var(--or);
		color: var(--or);
	}

	.alerta-sucesso {
		background: #1a1a10;
		border: 1px solid #c8a02e;
		padding: 16px;
		border-radius: 4px;
	}

	.aviso-critico {
		color: #ff5252;
		font-weight: bold;
		font-size: 12px;
		margin: 8px 0;
	}

	.area-copia {
		display: flex;
		gap: 8px;
		margin: 16px 0;
	}

	code {
		flex: 1;
		background: black;
		padding: 10px;
		color: #00ff00;
		font-family: monospace;
		font-size: 14px;
		word-break: break-all;
		border-radius: 2px;
	}

	.btn-copiar {
		background: var(--or);
		color: var(--sable);
		font-weight: bold;
		border: none;
	}

	.nota {
		font-size: 11px;
		color: var(--argent-fraco);
		margin-bottom: 16px;
	}

	.btn-voltar {
		width: 100%;
		font-size: 12px;
		min-height: 32px;
	}

	.msg-erro {
		color: var(--gules);
		font-size: 12px;
		margin-top: 12px;
	}

	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.85);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
	}

	.modal {
		background: var(--sable-2);
		border: 1px solid var(--or);
		padding: 24px;
		max-width: 400px;
		border-radius: 4px;
	}

	.modal h4 {
		margin-bottom: 12px;
		color: var(--or);
	}

	.modal p {
		font-size: 13px;
		margin-bottom: 24px;
		color: var(--argent);
	}

	.modal-acoes {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}

	.btn-confirmar {
		background: var(--gules-forte);
		color: white;
		border: none;
	}
</style>
