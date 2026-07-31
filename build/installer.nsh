; Fechamento do app antes de instalar/atualizar.
;
; O Gestor de Vendas fica na bandeja: o "X" da janela so esconde, pra continuar
; recebendo mensagens do WhatsApp em segundo plano. Por causa disso, o pedido
; educado de fechamento que o instalador manda apenas escondia a janela — o
; processo continuava de pe e a instalacao parava em "Nao e possivel fechar o
; Gestor de Vendas. Feche a janela e clique em Repetir".
;
; A sequencia abaixo resolve sem depender do usuario:
;   1) pede pra fechar (fecha, ou esconde se a janela estiver aberta);
;   2) pede de novo — com a janela ja escondida, o app entende que quem pediu
;      foi o instalador e sai de verdade, desconectando o WhatsApp direito;
;   3) so se ainda assim continuar de pe, encerra a forca (o banco e WAL e o
;      lock do Chrome e limpo na proxima abertura).

!macro customCheckAppRunning
  DetailPrint "Fechando o ${PRODUCT_NAME}, se estiver aberto..."

  nsExec::Exec 'taskkill /IM "${APP_EXECUTABLE_FILENAME}"'
  Pop $0
  Sleep 2500

  nsExec::Exec 'taskkill /IM "${APP_EXECUTABLE_FILENAME}"'
  Pop $0
  Sleep 3500

  nsExec::Exec 'taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
  Pop $0
  Sleep 1000
!macroend
