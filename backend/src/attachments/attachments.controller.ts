import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { createReadStream, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Role } from '../../generated/prisma/client';
import { AttachmentsService } from './attachments.service';
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  ATTACHMENTS_ROOT,
  MAX_ATTACHMENT_SIZE_BYTES,
} from './attachments.constants';

@ApiTags('ticket-attachments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tickets/:ticketId/attachments')
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @ApiOperation({
    summary: "Lister les pièces jointes d'un ticket",
    description:
      "Réservé à l'employé propriétaire, au technicien assigné, ou aux rôles SUPERVISOR/ADMIN (RM-04)",
  })
  @Get()
  findAll(@Param('ticketId') ticketId: string, @Req() req: Request) {
    const requester = req.user as { userId: string; role: Role };
    return this.attachmentsService.findAllForTicket(ticketId, requester);
  }

  @ApiOperation({
    summary: 'Joindre un fichier',
    description:
      "Réservé à l'employé propriétaire, au technicien assigné, ou aux rôles SUPERVISOR/ADMIN",
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, _file, callback) => {
          const dir = join(
            ATTACHMENTS_ROOT,
            (req.params as { ticketId: string }).ticketId,
          );
          mkdirSync(dir, { recursive: true });
          callback(null, dir);
        },
        filename: (_req, file, callback) => {
          callback(null, `${randomUUID()}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: MAX_ATTACHMENT_SIZE_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!ALLOWED_ATTACHMENT_MIME_TYPES.includes(file.mimetype)) {
          callback(
            new BadRequestException(
              `Type de fichier non autorisé : ${file.mimetype}`,
            ),
            false,
          );
          return;
        }
        callback(null, true);
      },
    }),
  )
  async create(
    @Param('ticketId') ticketId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('Aucun fichier fourni');
    }

    const requester = req.user as { userId: string; role: Role };
    return this.attachmentsService.create(ticketId, requester, file);
  }

  @ApiOperation({
    summary: 'Télécharger une pièce jointe',
    description:
      "Réservé à l'employé propriétaire, au technicien assigné, ou aux rôles SUPERVISOR/ADMIN (RM-04)",
  })
  @Get(':attachmentId/download')
  async download(
    @Param('ticketId') ticketId: string,
    @Param('attachmentId') attachmentId: string,
    @Req() req: Request,
  ) {
    const requester = req.user as { userId: string; role: Role };
    const attachment = await this.attachmentsService.findOneOrThrow(
      ticketId,
      attachmentId,
      requester,
    );
    const filePath = this.attachmentsService.resolveFilePath(
      ticketId,
      attachment.storedFileName,
    );

    return new StreamableFile(createReadStream(filePath), {
      type: attachment.mimeType,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
    });
  }
}
